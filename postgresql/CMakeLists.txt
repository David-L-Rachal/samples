cmake_minimum_required(VERSION 3.20)
project(PostgreSqlConsoleSample VERSION 1.0.0 LANGUAGES CXX)

find_package(PostgreSQL REQUIRED)

add_executable(postgresql_console main.cpp)
target_compile_features(postgresql_console PRIVATE cxx_std_20)
target_link_libraries(postgresql_console PRIVATE PostgreSQL::PostgreSQL)
target_compile_options(postgresql_console PRIVATE -Wall -Wextra -Wpedantic)
