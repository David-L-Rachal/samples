#include <arpa/inet.h>
#include <curl/curl.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

#include <array>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace
{
	constexpr std::string_view authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
	constexpr std::string_view tokenEndpoint = "https://oauth2.googleapis.com/token";
	constexpr std::string_view userInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
	constexpr std::string_view driveFilesEndpoint = "https://www.googleapis.com/drive/v3/files";

	class Socket
	{
	public:
		explicit Socket(int descriptor = -1) : descriptor(descriptor) {}
		~Socket()
		{
			if(descriptor >= 0)
			{
				close(descriptor);
			}
		}
		Socket(const Socket&) = delete;
		Socket& operator=(const Socket&) = delete;
		Socket(Socket&& other) noexcept : descriptor(other.descriptor)
		{
			other.descriptor = -1;
		}
		int Get() const
		{
			return descriptor;
		}

	private:
		int descriptor;
	};

	struct CurlCleanup
	{
		void operator()(CURL* curl) const
		{
			curl_easy_cleanup(curl);
		}
	};
	using Curl = std::unique_ptr<CURL, CurlCleanup>;

	struct FileCleanup
	{
		void operator()(FILE* file) const
		{
			fclose(file);
		}
	};
	using File = std::unique_ptr<FILE, FileCleanup>;

	std::string Environment(const char* name, bool required)
	{
		const char* value = std::getenv(name);
		if((value == nullptr || *value == '\0') && required)
		{
			throw std::runtime_error(std::string("Set ") + name + " before running the sample");
		}
		return value == nullptr ? "" : value;
	}

	std::string Base64Url(const unsigned char* bytes, std::size_t size)
	{
		std::string encoded(4 * ((size + 2) / 3), '\0');
		int encodedSize = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(encoded.data()), bytes,
		                                  static_cast<int>(size));
		encoded.resize(static_cast<std::size_t>(encodedSize));
		while(!encoded.empty() && encoded.back() == '=')
		{
			encoded.pop_back();
		}
		for(char& ch : encoded)
		{
			if(ch == '+')
			{
				ch = '-';
			}
			else if(ch == '/')
			{
				ch = '_';
			}
		}
		return encoded;
	}

	std::string RandomValue(std::size_t byteCount)
	{
		std::string bytes(byteCount, '\0');
		if(RAND_bytes(reinterpret_cast<unsigned char*>(bytes.data()), static_cast<int>(bytes.size())) != 1)
		{
			throw std::runtime_error("OpenSSL could not generate secure random bytes");
		}
		return Base64Url(reinterpret_cast<const unsigned char*>(bytes.data()), bytes.size());
	}

	std::string CodeChallenge(const std::string& verifier)
	{
		std::array<unsigned char, 32> digest{};
		unsigned int digestSize = 0;
		EVP_MD_CTX* rawContext = EVP_MD_CTX_new();
		if(rawContext == nullptr)
		{
			throw std::runtime_error("OpenSSL could not allocate a digest context");
		}
		std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context(rawContext, EVP_MD_CTX_free);
		if(EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) != 1 ||
		   EVP_DigestUpdate(context.get(), verifier.data(), verifier.size()) != 1 ||
		   EVP_DigestFinal_ex(context.get(), digest.data(), &digestSize) != 1)
		{
			throw std::runtime_error("OpenSSL could not create the PKCE challenge");
		}
		return Base64Url(digest.data(), digestSize);
	}

	std::string UrlEncode(CURL* curl, const std::string& value)
	{
		char* encodedValue = curl_easy_escape(curl, value.c_str(), static_cast<int>(value.size()));
		if(encodedValue == nullptr)
		{
			throw std::runtime_error("libcurl could not URL-encode a value");
		}
		std::unique_ptr<char, decltype(&curl_free)> encoded(encodedValue, curl_free);
		return encoded.get();
	}

	std::string Query(const std::map<std::string, std::string>& values)
	{
		Curl curl(curl_easy_init());
		if(!curl)
		{
			throw std::runtime_error("libcurl initialization failed");
		}
		std::string result;
		for(const auto& [name, value] : values)
		{
			result += result.empty() ? "" : "&";
			result += UrlEncode(curl.get(), name) + "=" + UrlEncode(curl.get(), value);
		}
		return result;
	}

	std::string UrlDecode(std::string_view value)
	{
		Curl curl(curl_easy_init());
		int decodedSize = 0;
		char* decodedValue = curl_easy_unescape(curl.get(), value.data(), static_cast<int>(value.size()), &decodedSize);
		if(decodedValue == nullptr)
		{
			throw std::runtime_error("libcurl could not URL-decode the callback");
		}
		std::unique_ptr<char, decltype(&curl_free)> decoded(decodedValue, curl_free);
		return std::string(decoded.get(), static_cast<std::size_t>(decodedSize));
	}

	std::map<std::string, std::string> ParseQuery(std::string_view query)
	{
		std::map<std::string, std::string> values;
		while(!query.empty())
		{
			auto separator = query.find('&');
			auto item = query.substr(0, separator);
			auto equals = item.find('=');
			if(equals != std::string_view::npos)
			{
				values[UrlDecode(item.substr(0, equals))] = UrlDecode(item.substr(equals + 1));
			}
			if(separator == std::string_view::npos)
			{
				break;
			}
			query.remove_prefix(separator + 1);
		}
		return values;
	}

	Socket Listen(unsigned short& port)
	{
		Socket listener(socket(AF_INET, SOCK_STREAM, 0));
		if(listener.Get() < 0)
		{
			throw std::runtime_error("Could not create the loopback listener");
		}
		int enabled = 1;
		setsockopt(listener.Get(), SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
		sockaddr_in address{};
		address.sin_family = AF_INET;
		address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
		address.sin_port = 0;
		if(bind(listener.Get(), reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
		   listen(listener.Get(), 1) != 0)
		{
			throw std::runtime_error("Could not bind the loopback listener");
		}
		socklen_t addressSize = sizeof(address);
		if(getsockname(listener.Get(), reinterpret_cast<sockaddr*>(&address), &addressSize) != 0)
		{
			throw std::runtime_error("Could not determine the loopback port");
		}
		port = ntohs(address.sin_port);
		return listener;
	}

	std::map<std::string, std::string> WaitForCallback(const Socket& listener)
	{
		fd_set sockets;
		FD_ZERO(&sockets);
		FD_SET(listener.Get(), &sockets);
		timeval timeout{120, 0};
		int ready = select(listener.Get() + 1, &sockets, nullptr, nullptr, &timeout);
		if(ready <= 0)
		{
			throw std::runtime_error(ready == 0 ? "OAuth callback timed out" : "Could not wait for OAuth callback");
		}
		Socket connection(accept(listener.Get(), nullptr, nullptr));
		if(connection.Get() < 0)
		{
			throw std::runtime_error("Could not accept the OAuth callback");
		}
		std::array<char, 16384> request{};
		ssize_t requestSize = recv(connection.Get(), request.data(), request.size() - 1, 0);
		if(requestSize <= 0)
		{
			throw std::runtime_error("Could not read the OAuth callback");
		}
		std::string_view firstLine(request.data(), static_cast<std::size_t>(requestSize));
		auto lineEnd = firstLine.find("\r\n");
		firstLine = firstLine.substr(0, lineEnd);
		if(!firstLine.starts_with("GET /?"))
		{
			throw std::runtime_error("Unexpected OAuth callback request");
		}
		auto httpMarker = firstLine.find(" HTTP/");
		if(httpMarker == std::string_view::npos)
		{
			throw std::runtime_error("Malformed OAuth callback request");
		}
		auto values = ParseQuery(firstLine.substr(6, httpMarker - 6));
		constexpr std::string_view response =
		    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n"
		    "<!doctype html><title>Nimbus OAuth</title><p>You may close this tab and return to the sample.</p>";
		send(connection.Get(), response.data(), response.size(), 0);
		return values;
	}

	size_t AppendResponse(char* data, size_t size, size_t count, void* output)
	{
		auto* response = static_cast<std::string*>(output);
		response->append(data, size * count);
		return size * count;
	}

	std::string Request(const std::string& url, const std::string& postFields = "",
	                    const std::string& bearerToken = "")
	{
		Curl curl(curl_easy_init());
		if(!curl)
		{
			throw std::runtime_error("libcurl initialization failed");
		}
		std::string response;
		curl_easy_setopt(curl.get(), CURLOPT_URL, url.c_str());
		curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, AppendResponse);
		curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, &response);
		curl_easy_setopt(curl.get(), CURLOPT_TIMEOUT, 30L);
		curl_easy_setopt(curl.get(), CURLOPT_FOLLOWLOCATION, 0L);
		curl_easy_setopt(curl.get(), CURLOPT_PROTOCOLS_STR, "https");
		if(!postFields.empty())
		{
			curl_easy_setopt(curl.get(), CURLOPT_POSTFIELDS, postFields.c_str());
		}
		curl_slist* rawHeaders = nullptr;
		std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> headers(nullptr, curl_slist_free_all);
		if(!bearerToken.empty())
		{
			rawHeaders = curl_slist_append(nullptr, ("Authorization: Bearer " + bearerToken).c_str());
			headers.reset(rawHeaders);
			curl_easy_setopt(curl.get(), CURLOPT_HTTPHEADER, headers.get());
		}
		auto result = curl_easy_perform(curl.get());
		long status = 0;
		curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &status);
		if(result != CURLE_OK || status < 200 || status >= 300)
		{
			throw std::runtime_error("Google request failed (HTTP " + std::to_string(status) + "): " + response);
		}
		return response;
	}

	std::string SafeFileName(const std::string& name)
	{
		std::string result;
		for(char ch : name)
		{
			if(ch == '/' || ch == '\\' || static_cast<unsigned char>(ch) < 32)
			{
				result += '_';
			}
			else
			{
				result += ch;
			}
		}
		return result.empty() || result == "." || result == ".." ? "google-drive-download" : result;
	}

	std::pair<std::string, std::string> ExportFormat(const std::string& mimeType)
	{
		if(mimeType == "application/vnd.google-apps.document")
		{
			return {"application/pdf", ".pdf"};
		}
		if(mimeType == "application/vnd.google-apps.spreadsheet")
		{
			return {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"};
		}
		if(mimeType == "application/vnd.google-apps.presentation")
		{
			return {"application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"};
		}
		return {};
	}

	void Download(const std::string& url, const std::string& bearerToken,
	              const std::filesystem::path& outputPath)
	{
		if(std::filesystem::exists(outputPath))
		{
			throw std::runtime_error("Refusing to replace the existing output file: " + outputPath.string());
		}
		auto parent = outputPath.parent_path();
		if(parent.empty())
		{
			parent = ".";
		}
		std::filesystem::create_directories(parent);
		std::string nameTemplate = (parent / ".nimbus-google-download-XXXXXX.part").string();
		std::vector<char> temporaryName(nameTemplate.begin(), nameTemplate.end());
		temporaryName.push_back('\0');
		int descriptor = mkstemps(temporaryName.data(), 5);
		if(descriptor < 0)
		{
			throw std::runtime_error("Could not create a temporary download file");
		}
		std::filesystem::path temporaryPath(temporaryName.data());
		FILE* rawFile = fdopen(descriptor, "wb");
		if(rawFile == nullptr)
		{
			close(descriptor);
			std::filesystem::remove(temporaryPath);
			throw std::runtime_error("Could not open the temporary download file");
		}
		File file(rawFile);
		try
		{
			Curl curl(curl_easy_init());
			if(!curl)
			{
				throw std::runtime_error("libcurl initialization failed");
			}
			std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> headers(
			    curl_slist_append(nullptr, ("Authorization: Bearer " + bearerToken).c_str()), curl_slist_free_all);
			curl_easy_setopt(curl.get(), CURLOPT_URL, url.c_str());
			curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, file.get());
			curl_easy_setopt(curl.get(), CURLOPT_TIMEOUT, 300L);
			curl_easy_setopt(curl.get(), CURLOPT_FOLLOWLOCATION, 0L);
			curl_easy_setopt(curl.get(), CURLOPT_PROTOCOLS_STR, "https");
			curl_easy_setopt(curl.get(), CURLOPT_HTTPHEADER, headers.get());
			auto result = curl_easy_perform(curl.get());
			long status = 0;
			curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &status);
			if(result != CURLE_OK || status < 200 || status >= 300)
			{
				throw std::runtime_error("Google download failed (HTTP " + std::to_string(status) + ")");
			}
			if(fflush(file.get()) != 0 || fsync(fileno(file.get())) != 0)
			{
				throw std::runtime_error("Could not flush the downloaded file");
			}
			file.reset();
			std::filesystem::rename(temporaryPath, outputPath);
		}
		catch(...)
		{
			file.reset();
			std::filesystem::remove(temporaryPath);
			throw;
		}
	}
}

int main()
{
	try
	{
		if(curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK)
		{
			throw std::runtime_error("libcurl global initialization failed");
		}
		struct CurlGlobalCleanup
		{
			~CurlGlobalCleanup()
			{
				curl_global_cleanup();
			}
		} cleanup;

		const std::string clientId = Environment("GOOGLE_OAUTH_CLIENT_ID", true);
		const std::string clientSecret = Environment("GOOGLE_OAUTH_CLIENT_SECRET", false);
		std::string scopes = Environment("GOOGLE_OAUTH_SCOPES", false);
		if(scopes.empty())
		{
			scopes = "openid email profile https://www.googleapis.com/auth/drive.readonly";
		}

		unsigned short port = 0;
		Socket listener = Listen(port);
		const std::string redirectUri = "http://127.0.0.1:" + std::to_string(port);
		const std::string state = RandomValue(32);
		const std::string verifier = RandomValue(64);
		const std::string authorizationUrl = std::string(authorizationEndpoint) + "?" +
		    Query({{"access_type", "offline"}, {"client_id", clientId},
		           {"code_challenge", CodeChallenge(verifier)}, {"code_challenge_method", "S256"},
		           {"prompt", "consent"}, {"redirect_uri", redirectUri}, {"response_type", "code"},
		           {"scope", scopes}, {"state", state}});

		std::cout << "Open this URL in your browser:\n\n" << authorizationUrl << "\n\nWaiting for Google...\n";
		auto callback = WaitForCallback(listener);
		if(callback["state"] != state)
		{
			throw std::runtime_error("OAuth state mismatch; refusing the callback");
		}
		if(callback.contains("error"))
		{
			throw std::runtime_error("Google authorization failed: " + callback["error"]);
		}
		if(!callback.contains("code") || callback["code"].empty())
		{
			throw std::runtime_error("Google did not return an authorization code");
		}

		std::map<std::string, std::string> tokenFields{{"client_id", clientId}, {"code", callback["code"]},
		                                                    {"code_verifier", verifier},
		                                                    {"grant_type", "authorization_code"},
		                                                    {"redirect_uri", redirectUri}};
		if(!clientSecret.empty())
		{
			tokenFields["client_secret"] = clientSecret;
		}
		auto token = nlohmann::json::parse(Request(std::string(tokenEndpoint), Query(tokenFields)));
		const std::string accessToken = token.at("access_token").get<std::string>();
		auto user = nlohmann::json::parse(Request(std::string(userInfoEndpoint), "", accessToken));

		std::cout << "Authorized Google account:\n"
		          << "  subject: " << user.value("sub", "") << '\n'
		          << "  email:   " << user.value("email", "") << '\n'
		          << "  name:    " << user.value("name", "") << '\n'
		          << "  refresh token returned: " << (token.contains("refresh_token") ? "yes" : "no") << "\n\n";

		Curl encoder(curl_easy_init());
		if(!encoder)
		{
			throw std::runtime_error("libcurl initialization failed");
		}
		const std::string listUrl = std::string(driveFilesEndpoint) + "?" +
		    Query({{"fields", "files(id,name,mimeType,capabilities(canDownload)),nextPageToken"},
		           {"orderBy", "modifiedTime desc"}, {"pageSize", "25"}, {"q", "trashed=false"}});
		auto listing = nlohmann::json::parse(Request(listUrl, "", accessToken));
		std::cout << "Recent Drive files:\n";
		for(const auto& file : listing.value("files", nlohmann::json::array()))
		{
			std::cout << "  " << file.value("id", "") << "  " << file.value("name", "")
			          << (file.value("capabilities", nlohmann::json::object()).value("canDownload", false) ? "" :
			                                                                                                  " [blocked]")
			          << '\n';
		}
		std::cout << "\nEnter a file ID to download, or press Enter to stop: ";
		std::string fileId;
		std::getline(std::cin, fileId);
		if(fileId.empty())
		{
			return 0;
		}

		const std::string encodedFileId = UrlEncode(encoder.get(), fileId);
		const std::string metadataUrl = std::string(driveFilesEndpoint) + "/" + encodedFileId + "?" +
		    Query({{"fields", "id,name,mimeType,capabilities(canDownload)"}});
		auto metadata = nlohmann::json::parse(Request(metadataUrl, "", accessToken));
		if(!metadata.value("capabilities", nlohmann::json::object()).value("canDownload", false))
		{
			throw std::runtime_error("Google reports that this account cannot download the selected file");
		}
		std::string suggestedName = SafeFileName(metadata.value("name", "google-drive-download"));
		std::string downloadUrl;
		auto exportFormat = ExportFormat(metadata.value("mimeType", ""));
		if(!exportFormat.first.empty())
		{
			suggestedName += exportFormat.second;
			downloadUrl = std::string(driveFilesEndpoint) + "/" + encodedFileId + "/export?" +
			    Query({{"mimeType", exportFormat.first}});
		}
		else if(metadata.value("mimeType", "").starts_with("application/vnd.google-apps."))
		{
			throw std::runtime_error("This Google Workspace file type is not supported by the sample exporter");
		}
		else
		{
			downloadUrl = std::string(driveFilesEndpoint) + "/" + encodedFileId + "?alt=media";
		}
		std::cout << "Save as [" << suggestedName << "]: ";
		std::string requestedOutput;
		std::getline(std::cin, requestedOutput);
		std::filesystem::path outputPath = requestedOutput.empty() ? suggestedName : requestedOutput;
		Download(downloadUrl, accessToken, outputPath);
		std::cout << "Downloaded to " << std::filesystem::absolute(outputPath) << '\n';
		return 0;
	}
	catch(const std::exception& error)
	{
		std::cerr << "Error: " << error.what() << '\n';
		return 1;
	}
}
