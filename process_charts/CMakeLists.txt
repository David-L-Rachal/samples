cmake_minimum_required(VERSION 3.20)
project(NimbusProcessCharts VERSION 0.1.0 LANGUAGES CXX)

add_executable(nimbus_process_charts main.cpp)
target_compile_features(nimbus_process_charts PRIVATE cxx_std_20)
target_compile_options(nimbus_process_charts PRIVATE -Wall -Wextra -Wpedantic)
