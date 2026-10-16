cmake_minimum_required(VERSION 3.20)
project(VitalTop VERSION 1.0.0 LANGUAGES CXX)

find_package(Curses REQUIRED)

add_executable(vitaltop main.cpp)
target_compile_features(vitaltop PRIVATE cxx_std_20)
target_include_directories(vitaltop PRIVATE ${CURSES_INCLUDE_DIRS})
target_link_libraries(vitaltop PRIVATE ${CURSES_LIBRARIES})
target_compile_options(vitaltop PRIVATE -Wall -Wextra -Wpedantic)
