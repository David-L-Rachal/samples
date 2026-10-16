#include <ncurses.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace
{
	constexpr int normalPair = 1;
	constexpr int brightPair = 2;
	constexpr int warningPair = 3;
	constexpr int criticalPair = 4;
	constexpr int mutedPair = 5;
	constexpr int headerPair = 6;
	constexpr int badgePair = 7;
	volatile std::sig_atomic_t interrupted = 0;

	struct CpuTimes
	{
		unsigned long long total = 0;
		unsigned long long idle = 0;
	};

	struct MemoryInfo
	{
		unsigned long long totalKiB = 0;
		unsigned long long availableKiB = 0;
	};

	struct ProcessInfo
	{
		int pid = 0;
		std::string name;
		unsigned long long residentKiB = 0;
	};

	struct PipeCleanup
	{
		void operator()(FILE* pipe) const
		{
			pclose(pipe);
		}
	};

	class Screen
	{
	public:
		Screen()
		{
			if(initscr() == nullptr)
			{
				throw std::runtime_error("Could not initialize the terminal");
			}
			cbreak();
			noecho();
			curs_set(0);
			keypad(stdscr, TRUE);
			nodelay(stdscr, TRUE);
			if(has_colors())
			{
				start_color();
				use_default_colors();
				init_pair(normalPair, COLOR_GREEN, -1);
				init_pair(brightPair, COLOR_CYAN, -1);
				init_pair(warningPair, COLOR_YELLOW, -1);
				init_pair(criticalPair, COLOR_RED, -1);
				init_pair(mutedPair, COLOR_WHITE, -1);
				init_pair(headerPair, COLOR_BLACK, COLOR_CYAN);
				init_pair(badgePair, COLOR_BLACK, COLOR_GREEN);
			}
		}

		~Screen()
		{
			endwin();
		}

		Screen(const Screen&) = delete;
		Screen& operator=(const Screen&) = delete;
	};

	void Interrupt(int)
	{
		interrupted = 1;
	}

	CpuTimes ReadCpuTimes()
	{
		std::ifstream input("/proc/stat");
		std::string label;
		unsigned long long user = 0;
		unsigned long long nice = 0;
		unsigned long long system = 0;
		unsigned long long idle = 0;
		unsigned long long ioWait = 0;
		unsigned long long irq = 0;
		unsigned long long softIrq = 0;
		unsigned long long steal = 0;
		input >> label >> user >> nice >> system >> idle >> ioWait >> irq >> softIrq >> steal;
		if(!input || label != "cpu")
		{
			throw std::runtime_error("Could not read /proc/stat");
		}
		return {user + nice + system + idle + ioWait + irq + softIrq + steal, idle + ioWait};
	}

	double CpuUsage(const CpuTimes& previous, const CpuTimes& current)
	{
		const auto totalDelta = current.total - previous.total;
		const auto idleDelta = current.idle - previous.idle;
		return totalDelta == 0 ? 0.0 : 100.0 * static_cast<double>(totalDelta - idleDelta) /
		                                      static_cast<double>(totalDelta);
	}

	MemoryInfo ReadMemoryInfo()
	{
		std::ifstream input("/proc/meminfo");
		MemoryInfo memory;
		std::string name;
		unsigned long long value = 0;
		std::string unit;
		while(input >> name >> value >> unit)
		{
			if(name == "MemTotal:")
			{
				memory.totalKiB = value;
			}
			else if(name == "MemAvailable:")
			{
				memory.availableKiB = value;
			}
		}
		return memory;
	}

	std::array<double, 3> ReadLoadAverage()
	{
		std::ifstream input("/proc/loadavg");
		std::array<double, 3> load{};
		input >> load[0] >> load[1] >> load[2];
		return load;
	}

	std::string ReadTextValue(const std::filesystem::path& path, const std::string& wanted)
	{
		std::ifstream input(path);
		std::string line;
		while(std::getline(input, line))
		{
			if(line.starts_with(wanted))
			{
				return line.substr(wanted.size());
			}
		}
		return {};
	}

	std::vector<ProcessInfo> ReadProcesses()
	{
		std::vector<ProcessInfo> processes;
		for(const auto& entry : std::filesystem::directory_iterator("/proc"))
		{
			const std::string directoryName = entry.path().filename().string();
			if(directoryName.empty() || !std::ranges::all_of(directoryName, [](unsigned char ch) { return std::isdigit(ch); }))
			{
				continue;
			}
			try
			{
				const auto statusPath = entry.path() / "status";
				std::string name = ReadTextValue(statusPath, "Name:\t");
				std::string resident = ReadTextValue(statusPath, "VmRSS:\t");
				unsigned long long residentKiB = 0;
				std::istringstream(resident) >> residentKiB;
				processes.push_back({std::stoi(directoryName), std::move(name), residentKiB});
			}
			catch(const std::exception&)
			{
				// Processes can disappear while /proc is being scanned.
			}
		}
		std::ranges::sort(processes, {}, &ProcessInfo::residentKiB);
		std::ranges::reverse(processes);
		return processes;
	}

	std::vector<std::string> ReadSystemErrors()
	{
		using Pipe = std::unique_ptr<FILE, PipeCleanup>;
		Pipe pipe(popen("journalctl --boot --priority=err --no-pager --output=short-monotonic -n 8 2>/dev/null", "r"),
		          PipeCleanup{});
		if(!pipe)
		{
			return {"System journal is unavailable"};
		}
		std::vector<std::string> errors;
		std::array<char, 1024> buffer{};
		while(fgets(buffer.data(), static_cast<int>(buffer.size()), pipe.get()) != nullptr)
		{
			std::string line(buffer.data());
			while(!line.empty() && (line.back() == '\n' || line.back() == '\r'))
			{
				line.pop_back();
			}
			if(!line.empty() && line != "-- No entries --")
			{
				errors.push_back(std::move(line));
			}
		}
		if(errors.empty())
		{
			errors.push_back("No error-priority journal entries this boot");
		}
		return errors;
	}

	std::string FormatMemory(unsigned long long valueKiB)
	{
		std::ostringstream output;
		output << std::fixed << std::setprecision(1);
		if(valueKiB >= 1024ULL * 1024ULL)
		{
			output << static_cast<double>(valueKiB) / (1024.0 * 1024.0) << " GiB";
		}
		else
		{
			output << static_cast<double>(valueKiB) / 1024.0 << " MiB";
		}
		return output.str();
	}

	void DrawBox(int top, int left, int height, int width, const std::string& title, int colorPair = normalPair)
	{
		attron(COLOR_PAIR(colorPair));
		mvhline(top, left + 1, ACS_HLINE, width - 2);
		mvhline(top + height - 1, left + 1, ACS_HLINE, width - 2);
		mvvline(top + 1, left, ACS_VLINE, height - 2);
		mvvline(top + 1, left + width - 1, ACS_VLINE, height - 2);
		mvaddch(top, left, ACS_ULCORNER);
		mvaddch(top, left + width - 1, ACS_URCORNER);
		mvaddch(top + height - 1, left, ACS_LLCORNER);
		mvaddch(top + height - 1, left + width - 1, ACS_LRCORNER);
		mvaddnstr(top, left + 3, ("[ " + title + " ]").c_str(), width - 6);
		attroff(COLOR_PAIR(colorPair));
	}

	void DrawLargeNumber(int top, int left, int number, int colorPair, std::string_view suffix)
	{
		static constexpr std::array<std::array<std::string_view, 5>, 10> digits{{
			{{"###", "# #", "# #", "# #", "###"}}, {{"  #", "  #", "  #", "  #", "  #"}},
			{{"###", "  #", "###", "#  ", "###"}}, {{"###", "  #", "###", "  #", "###"}},
			{{"# #", "# #", "###", "  #", "  #"}}, {{"###", "#  ", "###", "  #", "###"}},
			{{"###", "#  ", "###", "# #", "###"}}, {{"###", "  #", "  #", "  #", "  #"}},
			{{"###", "# #", "###", "# #", "###"}}, {{"###", "# #", "###", "  #", "###"}}
		}};
		const std::string value = std::to_string(std::clamp(number, 0, 999));
		attron(COLOR_PAIR(colorPair) | A_BOLD);
		for(int row = 0; row < 5; ++row)
		{
			int column = left;
			for(char digit : value)
			{
				for(char pixel : digits[static_cast<std::size_t>(digit - '0')][row])
				{
					mvaddch(top + row, column++, pixel == '#' ? ACS_CKBOARD : ' ');
				}
				++column;
			}
		}
		mvaddnstr(top + 4, left + static_cast<int>(value.size()) * 4, suffix.data(), static_cast<int>(suffix.size()));
		attroff(COLOR_PAIR(colorPair) | A_BOLD);
	}

	void DrawTrace(int top, int left, int height, int width, const std::deque<double>& history, double verticalMaximum,
	               int colorPair)
	{
		const int graphHeight = height - 2;
		const int graphWidth = width - 18;
		const int visibleValues = std::min<int>(graphWidth, history.size());
		const int baseline = top + height - 2;
		int previousY = baseline;
		attron(COLOR_PAIR(colorPair) | A_DIM);
		mvhline(baseline, left + 1, '_', graphWidth);
		attroff(COLOR_PAIR(colorPair) | A_DIM);
		attron(COLOR_PAIR(colorPair) | A_BOLD);
		for(int x = 0; x < visibleValues; ++x)
		{
			const double value = history[history.size() - visibleValues + x];
			const int y = baseline - static_cast<int>(std::round(
				std::clamp(value / verticalMaximum, 0.0, 1.0) * static_cast<double>(graphHeight - 1)));
			if(y + 1 < baseline)
			{
				attron(COLOR_PAIR(colorPair) | A_DIM);
				mvvline(y + 1, left + 1 + x, ACS_CKBOARD, baseline - y - 1);
				attroff(COLOR_PAIR(colorPair) | A_DIM);
				attron(COLOR_PAIR(colorPair) | A_BOLD);
			}
			if(x > 0)
			{
				const int startY = std::min(previousY, y);
				const int distance = std::abs(previousY - y);
				if(distance > 0)
				{
					mvvline(startY, left + 1 + x, '|', distance + 1);
				}
			}
			const chtype traceCharacter = x == visibleValues - 1 ? '|' : (y == baseline ? '_' : '-');
			mvaddch(y, left + 1 + x, traceCharacter);
			previousY = y;
		}
		attroff(COLOR_PAIR(colorPair) | A_BOLD);
	}

	void DrawChannel(int top, int height, int columns, const std::string& label, const std::string& unit,
	                 int displayValue, const std::deque<double>& history, double verticalMaximum, int colorPair)
	{
		DrawBox(top, 1, height, columns - 2, label, colorPair);
		DrawTrace(top, 1, height, columns - 2, history, verticalMaximum, colorPair);
		DrawLargeNumber(top + 1, columns - 15, displayValue, colorPair, unit);
		attron(COLOR_PAIR(colorPair));
		mvaddnstr(top + 1, columns - 5, unit.c_str(), 3);
		attroff(COLOR_PAIR(colorPair));
	}

	void DrawDashboard(double cpu, const MemoryInfo& memory, const std::array<double, 3>& load,
	                   const std::deque<double>& cpuHistory, const std::deque<double>& memoryHistory,
	                   const std::vector<ProcessInfo>& processes, const std::vector<std::string>& systemErrors)
	{
		erase();
		int rows = 0;
		int columns = 0;
		getmaxyx(stdscr, rows, columns);
		if(rows < 30 || columns < 80)
		{
			attron(COLOR_PAIR(criticalPair) | A_BOLD);
			mvprintw(1, 2, "VITALTOP needs a terminal at least 80 x 30 (current: %d x %d)", columns, rows);
			attroff(COLOR_PAIR(criticalPair) | A_BOLD);
			refresh();
			return;
		}

		attron(COLOR_PAIR(headerPair) | A_BOLD);
		mvhline(0, 0, ' ', columns);
		mvaddstr(0, 2, "VITALTOP / MULTI-PARAMETER SYSTEM MONITOR");
		attroff(COLOR_PAIR(headerPair) | A_BOLD);
		attron(COLOR_PAIR(badgePair) | A_BOLD);
		mvaddstr(0, columns - 22, " ACTIVE  [q] quit    ");
		attroff(COLOR_PAIR(badgePair) | A_BOLD);
		const double memoryUsed = memory.totalKiB == 0 ? 0.0 :
			100.0 * static_cast<double>(memory.totalKiB - memory.availableKiB) / memory.totalKiB;
		double memoryPeak = memoryUsed;
		if(!memoryHistory.empty())
		{
			memoryPeak = std::max(memoryPeak, *std::ranges::max_element(memoryHistory));
		}
		const double memoryScale = std::clamp(std::ceil(memoryPeak / 10.0) * 10.0, 10.0, 100.0);
		DrawChannel(2, 10, columns, "CPU / PROCESSOR ACTIVITY", "%", static_cast<int>(std::round(cpu)), cpuHistory,
		            100.0, normalPair);
		const std::string memoryLabel = "MEM / USED CAPACITY  0-" + std::to_string(static_cast<int>(memoryScale)) + "%";
		DrawChannel(12, 10, columns, memoryLabel, "%", static_cast<int>(std::round(memoryUsed)), memoryHistory,
		            memoryScale, brightPair);

		attron(COLOR_PAIR(mutedPair));
		mvprintw(1, 2, "CPU %5.1f%%   RAM %s / %s   LOAD %.2f  %.2f  %.2f", cpu,
		         FormatMemory(memory.totalKiB - memory.availableKiB).c_str(), FormatMemory(memory.totalKiB).c_str(),
		         load[0], load[1], load[2]);
		attroff(COLOR_PAIR(mutedPair));

		const int detailsTop = 23;
		const int detailsHeight = rows - detailsTop - 1;
		const int detailsLeftWidth = columns / 2;
		DrawBox(detailsTop, 1, detailsHeight, detailsLeftWidth - 1, "PROCESS PRESSURE", brightPair);
		DrawBox(detailsTop, detailsLeftWidth, detailsHeight, columns - detailsLeftWidth - 1, "SYSTEM ERRORS", criticalPair);
		attron(COLOR_PAIR(brightPair) | A_BOLD);
		mvprintw(detailsTop + 1, 3, "%7s  %-18s %10s", "PID", "PROCESS", "RESIDENT");
		attroff(COLOR_PAIR(brightPair) | A_BOLD);
		const int visibleProcesses = std::min<int>(detailsHeight - 3, processes.size());
		for(int index = 0; index < visibleProcesses; ++index)
		{
			const auto& process = processes[index];
			attron(COLOR_PAIR(index == 0 ? warningPair : mutedPair));
			mvprintw(detailsTop + 2 + index, 3, "%7d  %-18.18s %10s", process.pid, process.name.c_str(),
			         FormatMemory(process.residentKiB).c_str());
			attroff(COLOR_PAIR(index == 0 ? warningPair : mutedPair));
		}
		const int errorWidth = columns - detailsLeftWidth - 5;
		const int visibleErrors = std::min<int>(detailsHeight - 2, systemErrors.size());
		for(int index = 0; index < visibleErrors; ++index)
		{
			attron(COLOR_PAIR(systemErrors[index].starts_with("No error") ? normalPair : criticalPair));
			mvaddnstr(detailsTop + 1 + index, detailsLeftWidth + 2, systemErrors[index].c_str(), errorWidth);
			attroff(COLOR_PAIR(systemErrors[index].starts_with("No error") ? normalPair : criticalPair));
		}

		attron(COLOR_PAIR(headerPair));
		mvhline(rows - 1, 0, ' ', columns);
		mvaddstr(rows - 1, 2, "[Q] QUIT");
		mvaddstr(rows - 1, 15, "CPU TRACE");
		mvaddstr(rows - 1, 30, "MEMORY TRACE");
		mvaddstr(rows - 1, 48, "LOAD IN STATUS LINE");
		mvaddstr(rows - 1, columns - 17, "0.5s REFRESH");
		attroff(COLOR_PAIR(headerPair));
		refresh();
	}
}

int main()
{
	try
	{
		std::signal(SIGINT, Interrupt);
		std::signal(SIGTERM, Interrupt);
		Screen screen;
		CpuTimes previousCpu = ReadCpuTimes();
		std::deque<double> cpuHistory;
		std::deque<double> memoryHistory;
		std::vector<std::string> systemErrors = ReadSystemErrors();
		int errorRefreshCountdown = 0;
		while(!interrupted)
		{
			std::this_thread::sleep_for(std::chrono::milliseconds(500));
			const CpuTimes currentCpu = ReadCpuTimes();
			const double cpu = CpuUsage(previousCpu, currentCpu);
			previousCpu = currentCpu;
			const MemoryInfo memory = ReadMemoryInfo();
			const std::array<double, 3> load = ReadLoadAverage();
			const double memoryUsed = memory.totalKiB == 0 ? 0.0 :
				100.0 * static_cast<double>(memory.totalKiB - memory.availableKiB) / memory.totalKiB;
			cpuHistory.push_back(cpu);
			memoryHistory.push_back(memoryUsed);
			while(cpuHistory.size() > 240)
			{
				cpuHistory.pop_front();
				memoryHistory.pop_front();
			}
			if(errorRefreshCountdown-- <= 0)
			{
				systemErrors = ReadSystemErrors();
				errorRefreshCountdown = 9;
			}
			DrawDashboard(cpu, memory, load, cpuHistory, memoryHistory, ReadProcesses(), systemErrors);
			const int key = getch();
			if(key == 'q' || key == 'Q')
			{
				break;
			}
		}
		return EXIT_SUCCESS;
	}
	catch(const std::exception& error)
	{
		endwin();
		std::cerr << "vitaltop: " << error.what() << "\n";
		return EXIT_FAILURE;
	}
}
