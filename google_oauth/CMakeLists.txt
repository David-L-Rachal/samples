cmake_minimum_required(VERSION 3.20)
project(NimbusGoogleOAuthSample VERSION 0.1.0 LANGUAGES CXX)

find_package(CURL 7.85 REQUIRED)
find_package(OpenSSL 3 REQUIRED COMPONENTS Crypto)
find_package(nlohmann_json 3.11 QUIET)

set(NIMBUS_NLOHMANN_JSON_INCLUDE_DIR ""
	CACHE PATH "Directory containing nlohmann/json.hpp")
if(NOT nlohmann_json_FOUND)
	find_path(NIMBUS_NLOHMANN_JSON_INCLUDE_DIR nlohmann/json.hpp
		HINTS ${NIMBUS_NLOHMANN_JSON_INCLUDE_DIR})
	if(NOT NIMBUS_NLOHMANN_JSON_INCLUDE_DIR)
		message(FATAL_ERROR
			"nlohmann/json.hpp was not found. Install nlohmann_json or set "
			"NIMBUS_NLOHMANN_JSON_INCLUDE_DIR to its include directory.")
	endif()
endif()

add_executable(nimbus_google_oauth main.cpp)
target_compile_features(nimbus_google_oauth PRIVATE cxx_std_20)
target_link_libraries(nimbus_google_oauth PRIVATE CURL::libcurl OpenSSL::Crypto)
if(nlohmann_json_FOUND)
	target_link_libraries(nimbus_google_oauth PRIVATE nlohmann_json::nlohmann_json)
else()
	target_include_directories(nimbus_google_oauth SYSTEM PRIVATE ${NIMBUS_NLOHMANN_JSON_INCLUDE_DIR})
endif()
target_compile_options(nimbus_google_oauth PRIVATE -Wall -Wextra -Wpedantic)
