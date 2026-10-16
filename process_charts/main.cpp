#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace
{
	constexpr double missing = std::numeric_limits<double>::quiet_NaN();

	struct Sample
	{
		std::chrono::system_clock::time_point time;
		std::array<double, 16> values{};
	};

	struct Bounds
	{
		double minimum = std::numeric_limits<double>::infinity();
		double maximum = -std::numeric_limits<double>::infinity();

		void Include(double value)
		{
			if(std::isfinite(value))
			{
				minimum = std::min(minimum, value);
				maximum = std::max(maximum, value);
			}
		}

		void AddPadding(double fraction)
		{
			double span = maximum - minimum;
			if(span <= 0.0)
			{
				span = std::max(1.0, std::abs(maximum) * 0.1);
			}
			minimum -= span * fraction;
			maximum += span * fraction;
		}
	};

	struct Panel
	{
		double top;
		double bottom;
		Bounds bounds;
		std::string title;
		std::string unit;
	};

	std::vector<std::string> Split(std::string_view line)
	{
		std::vector<std::string> fields;
		std::string field;
		bool quoted = false;
		for(char character : line)
		{
			if(character == '"')
			{
				quoted = !quoted;
			}
			else if(character == ',' && !quoted)
			{
				fields.push_back(field);
				field.clear();
			}
			else
			{
				field += character;
			}
		}
		fields.push_back(field);
		if(!fields.back().empty() && fields.back().back() == '\r')
		{
			fields.back().pop_back();
		}
		return fields;
	}

	double Number(const std::string& text)
	{
		if(text.empty())
		{
			return missing;
		}
		try
		{
			std::size_t consumed = 0;
			double value = std::stod(text, &consumed);
			return consumed == text.size() ? value : missing;
		}
		catch(const std::exception&)
		{
			return missing;
		}
	}

	std::chrono::system_clock::time_point Time(const std::string& text)
	{
		std::tm parsed{};
		std::istringstream input(text);
		input >> std::get_time(&parsed, "%Y-%m-%d %H:%M:%S");
		if(input.fail())
		{
			throw std::runtime_error("Invalid timestamp in CSV: " + text);
		}
		parsed.tm_isdst = -1;
		return std::chrono::system_clock::from_time_t(std::mktime(&parsed));
	}

	std::vector<Sample> Load(const std::filesystem::path& inputPath)
	{
		std::ifstream input(inputPath);
		if(!input)
		{
			throw std::runtime_error("Could not open " + inputPath.string());
		}

		std::string line;
		if(!std::getline(input, line))
		{
			throw std::runtime_error("The CSV is empty");
		}
		const std::vector<std::string> expected{
		    "Time",       "setpointA",   "tempHighA",    "TempLowA",     "tempA",       "setpointB",
		    "tempHighB",  "tempLowB",    "tempB",        "pressureA",    "pressureB",   "pressureLow",
		    "pressureHigh", "pressureDelta", "aFlow",       "bFlow",        "dynamicRatio"};
		if(Split(line) != expected)
		{
			throw std::runtime_error("The CSV headers do not match the expected labeled columns");
		}

		std::vector<Sample> samples;
		while(std::getline(input, line))
		{
			auto fields = Split(line);
			if(fields.size() != expected.size())
			{
				continue;
			}
			Sample sample;
			sample.time = Time(fields.front());
			for(std::size_t column = 1; column < fields.size(); ++column)
			{
				sample.values[column - 1] = Number(fields[column]);
			}
			// The source contains a second run appended with overlapping timestamps.
			// Keep one continuous process run so the chart does not draw two traces
			// over the same clock time.
			if(!samples.empty() && sample.time < samples.back().time)
			{
				break;
			}
			samples.push_back(sample);
		}
		if(samples.size() < 2)
		{
			throw std::runtime_error("The CSV does not contain enough samples");
		}
		return samples;
	}

	std::string Escape(std::string_view text)
	{
		std::string escaped;
		for(char character : text)
		{
			switch(character)
			{
			case '&': escaped += "&amp;"; break;
			case '<': escaped += "&lt;"; break;
			case '>': escaped += "&gt;"; break;
			default: escaped += character; break;
			}
		}
		return escaped;
	}

	class Chart
	{
	public:
		Chart(const std::vector<Sample>& samples, std::ostream& output)
		    : samples(samples), output(output), start(samples.front().time), finish(samples.back().time)
		{
		}

		void DrawTemperature()
		{
			Begin("Temperature and flow");
			Panel temperature{155, 515, SeriesBounds({0, 1, 2, 3, 4, 5, 6, 7}), "Temperature (°F)", "°F"};
			temperature.bounds.AddPadding(0.08);
			DrawPanel(temperature);
			DrawFlow(temperature);
			DrawLine(temperature, 1, "#d73045", 1.2, "5 7");
			DrawLine(temperature, 2, "#d73045", 1.2, "5 7");
			DrawLine(temperature, 5, "#2369d8", 1.2, "5 7");
			DrawLine(temperature, 6, "#2369d8", 1.2, "5 7");
			DrawLine(temperature, 0, "#d73045", 1.8, "9 6");
			DrawLine(temperature, 4, "#2369d8", 1.8, "9 6");
			DrawLine(temperature, 3, "#d73045", 3.0);
			DrawLine(temperature, 7, "#2369d8", 3.0);
			Legend(temperature.top - 17, {{"Temp A", "#d73045"}, {"Temp B", "#2369d8"},
			                              {"Flow overlap", "#7748a8"}});
			DrawTimeAxis(temperature);
			End();
		}

		void DrawPressure()
		{
			Begin("Pressure, delta, and flow");
			Panel pressure{155, 515, SeriesBounds({8, 9, 10, 11}), "Pressure (psi)", "psi"};
			pressure.bounds.AddPadding(0.08);
			DrawPanel(pressure);
			DrawFlow(pressure);
			DrawLine(pressure, 10, "#7748a8", 1.4, "6 7");
			DrawLine(pressure, 11, "#7748a8", 1.4, "6 7");
			DrawLine(pressure, 8, "#d73045", 3.0);
			DrawLine(pressure, 9, "#2369d8", 3.0);
			Bounds pressureDelta = SeriesBounds({12});
			pressureDelta.AddPadding(0.08);
			DrawSecondaryLine(pressure, 12, pressureDelta, "#7748a8", 2.0);
			DrawSecondaryAxis(pressure, pressureDelta, "Δ psi");
			Legend(pressure.top - 17, {{"Pressure A", "#d73045"}, {"Pressure B", "#2369d8"},
			                           {"Pressure Δ", "#7748a8"}, {"Flow overlap", "#7748a8"}});
			DrawTimeAxis(pressure);
			End();
		}

		void DrawRatio()
		{
			Begin("Dynamic ratio");
			Panel ratio{155, 515, {94.5, 105.5}, "Dynamic ratio (%)", "%"};
			DrawPanel(ratio);
			DrawLine(ratio, 15, "#7748a8", 3.0);
			DrawReference(ratio, 100.0, "#8896a8");
			DrawReference(ratio, 95.0, "#b6a2cc");
			DrawReference(ratio, 105.0, "#b6a2cc");
			Legend(ratio.top - 17, {{"Dynamic ratio", "#7748a8"}, {"100 target", "#8896a8"},
			                        {"95 / 105 bounds", "#b6a2cc"}});
			DrawTimeAxis(ratio);
			End();
		}

	private:
		const std::vector<Sample>& samples;
		std::ostream& output;
		std::chrono::system_clock::time_point start;
		std::chrono::system_clock::time_point finish;
		static constexpr double left = 105;
		static constexpr double right = 1400;

		void Begin(const std::string& heading)
		{
			output << R"(<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="640" viewBox="0 0 1600 640">)"
			       << '\n';
			output << R"(<rect width="1600" height="640" fill="#ffffff"/>)" << '\n';
			output << R"(<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>)" << '\n';
			output << "<defs><clipPath id=\"plot\"><rect x=\"" << left << "\" y=\"155\" width=\""
			       << right - left << "\" height=\"360\"/></clipPath></defs>\n";
			Text(75, 58, "Sample process data", 28, "#172033", 700);
			Text(75, 88, heading + " · October 2, 2025", 15, "#65758b", 400);
			Text(1525, 58, std::to_string(samples.size()) + " samples", 14, "#65758b", 500, "end");
		}

		void End()
		{
			output << "</svg>\n";
		}

		Bounds SeriesBounds(std::initializer_list<std::size_t> columns) const
		{
			Bounds bounds;
			for(const auto& sample : samples)
			{
				for(std::size_t column : columns)
				{
					bounds.Include(sample.values[column]);
				}
			}
			return bounds;
		}

		double X(const Sample& sample) const
		{
			auto elapsed = std::chrono::duration<double>(sample.time - start).count();
			auto duration = std::chrono::duration<double>(finish - start).count();
			return left + elapsed / duration * (right - left);
		}

		double Y(const Panel& panel, double value) const
		{
			return panel.bottom - (value - panel.bounds.minimum) / (panel.bounds.maximum - panel.bounds.minimum) *
			                          (panel.bottom - panel.top);
		}

		void Text(double x, double y, const std::string& text, int size, const std::string& color, int weight,
		          const std::string& anchor = "start")
		{
			output << "<text x=\"" << x << "\" y=\"" << y << "\" fill=\"" << color << "\" font-size=\"" << size
			       << "\" font-weight=\"" << weight << "\" text-anchor=\"" << anchor << "\">" << Escape(text)
			       << "</text>\n";
		}

		void DrawPanel(const Panel& panel)
		{
			output << "<rect x=\"55\" y=\"" << panel.top - 48
			       << "\" width=\"1490\" height=\"" << panel.bottom - panel.top + 74
			       << "\" rx=\"18\" fill=\"#f8fafc\" stroke=\"#dbe3ed\"/>\n";
			Text(left, panel.top - 17, panel.title, 18, "#263449", 650);
			for(int tick = 0; tick <= 4; ++tick)
			{
				double fraction = static_cast<double>(tick) / 4.0;
				double y = panel.bottom - fraction * (panel.bottom - panel.top);
				double value = panel.bounds.minimum + fraction * (panel.bounds.maximum - panel.bounds.minimum);
				output << "<line x1=\"" << left << "\" y1=\"" << y << "\" x2=\"" << right << "\" y2=\"" << y
				       << "\" stroke=\"#dce4ee\" stroke-width=\"1\"/>\n";
				std::ostringstream label;
				label << std::fixed << std::setprecision(panel.unit == "%" ? 2 : 0) << value;
				Text(left - 14, y + 4, label.str(), 12, "#65758b", 400, "end");
			}
		}

		void DrawLine(const Panel& panel, std::size_t column, const std::string& color, double width,
		              const std::string& dash = "")
		{
			output << "<path d=\"";
			bool drawing = false;
			for(const auto& sample : samples)
			{
				double value = sample.values[column];
				if(!std::isfinite(value))
				{
					drawing = false;
					continue;
				}
				output << (drawing ? "L" : "M") << std::fixed << std::setprecision(2) << X(sample) << ','
				       << Y(panel, value);
				drawing = true;
			}
			output << "\" clip-path=\"url(#plot)\" fill=\"none\" stroke=\"" << color << "\" stroke-width=\"" << width
			       << "\" stroke-linejoin=\"round\" stroke-linecap=\"round\"";
			if(!dash.empty())
			{
				output << " stroke-dasharray=\"" << dash << "\"";
			}
			output << "/>\n";
		}

		void DrawSecondaryLine(const Panel& panel, std::size_t column, const Bounds& bounds,
		                       const std::string& color, double width)
		{
			output << "<path d=\"";
			bool drawing = false;
			for(const auto& sample : samples)
			{
				double value = sample.values[column];
				if(!std::isfinite(value))
				{
					drawing = false;
					continue;
				}
				double y = panel.bottom - (value - bounds.minimum) / (bounds.maximum - bounds.minimum) *
				                              (panel.bottom - panel.top);
				output << (drawing ? "L" : "M") << std::fixed << std::setprecision(2) << X(sample) << ',' << y;
				drawing = true;
			}
			output << "\" clip-path=\"url(#plot)\" fill=\"none\" stroke=\"" << color << "\" stroke-width=\"" << width
			       << "\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.78\"/>\n";
		}

		void DrawSecondaryAxis(const Panel& panel, const Bounds& bounds, const std::string& unit)
		{
			Text(right + 14, panel.top - 17, unit, 12, "#7748a8", 600);
			for(int tick = 0; tick <= 4; ++tick)
			{
				double fraction = static_cast<double>(tick) / 4.0;
				double y = panel.bottom - fraction * (panel.bottom - panel.top);
				double value = bounds.minimum + fraction * (bounds.maximum - bounds.minimum);
				std::ostringstream label;
				label << std::fixed << std::setprecision(0) << value;
				Text(right + 14, y + 4, label.str(), 12, "#7748a8", 450);
			}
		}

		void DrawFlow(const Panel& panel)
		{
			Bounds flow = SeriesBounds({13, 14});
			for(std::size_t column : {13U, 14U})
			{
				const char* color = column == 13 ? "#d73045" : "#2369d8";
				output << "<path d=\"M" << left << ',' << panel.bottom;
				for(const auto& sample : samples)
				{
					double value = sample.values[column];
					if(std::isfinite(value))
					{
						double y = panel.bottom - value / flow.maximum * (panel.bottom - panel.top) * 0.28;
						output << "L" << std::fixed << std::setprecision(2) << X(sample) << ',' << y;
					}
				}
				output << "L" << right << ',' << panel.bottom << "Z\" clip-path=\"url(#plot)\" fill=\"" << color
				       << "\" opacity=\"0.22\"/>\n";
			}
		}

		void DrawReference(const Panel& panel, double value, const std::string& color)
		{
			double y = Y(panel, value);
			output << "<line x1=\"" << left << "\" y1=\"" << y << "\" x2=\"" << right << "\" y2=\"" << y
			       << "\" stroke=\"" << color << "\" stroke-width=\"1.5\" stroke-dasharray=\"7 7\"/>\n";
		}

		void Legend(double y, const std::vector<std::pair<std::string, std::string>>& items)
		{
			double x = right;
			for(auto item = items.rbegin(); item != items.rend(); ++item)
			{
				double width = 48 + item->first.size() * 7.0;
				x -= width;
				output << "<line x1=\"" << x << "\" y1=\"" << y - 5 << "\" x2=\"" << x + 22 << "\" y2=\"" << y - 5
				       << "\" stroke=\"" << item->second << "\" stroke-width=\"3\"/>\n";
				Text(x + 29, y, item->first, 12, "#53657b", 450);
			}
		}

		void DrawTimeAxis(const Panel& panel)
		{
			for(int tick = 0; tick <= 6; ++tick)
			{
				double fraction = static_cast<double>(tick) / 6.0;
				auto moment = start + std::chrono::duration_cast<std::chrono::system_clock::duration>(finish - start) * tick / 6;
				std::time_t time = std::chrono::system_clock::to_time_t(moment);
				std::ostringstream label;
				label << std::put_time(std::localtime(&time), "%I:%M %p");
				Text(left + fraction * (right - left), panel.bottom + 31, label.str(), 12, "#65758b", 400,
				     tick == 0 ? "start" : tick == 6 ? "end" : "middle");
			}
		}
	};
}

int main(int argc, char* argv[])
{
	try
	{
		if(argc != 3)
		{
			std::cerr << "Usage: " << argv[0] << " input.csv output-directory\n";
			return 2;
		}
		auto samples = Load(argv[1]);
		std::filesystem::path outputDirectory = argv[2];
		std::filesystem::create_directories(outputDirectory);
		const std::array<std::pair<std::string, void (Chart::*)()>, 3> charts{{
		    {"sample_temp.svg", &Chart::DrawTemperature},
		    {"sample_press.svg", &Chart::DrawPressure},
		    {"sample_ratio.svg", &Chart::DrawRatio},
		}};
		for(const auto& [fileName, draw] : charts)
		{
			std::ofstream output(outputDirectory / fileName);
			if(!output)
			{
				throw std::runtime_error("Could not create " + (outputDirectory / fileName).string());
			}
			Chart chart(samples, output);
			(chart.*draw)();
		}
		std::cout << "Wrote sample_temp.svg, sample_press.svg, and sample_ratio.svg to " << outputDirectory << " from "
		          << samples.size() << " samples\n";
		return 0;
	}
	catch(const std::exception& error)
	{
		std::cerr << "Error: " << error.what() << '\n';
		return 1;
	}
}
