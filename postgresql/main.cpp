#include <libpq-fe.h>

#include <cstdlib>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

namespace
{
	struct ConnectionCleanup
	{
		void operator()(PGconn* connection) const
		{
			PQfinish(connection);
		}
	};

	struct ResultCleanup
	{
		void operator()(PGresult* result) const
		{
			PQclear(result);
		}
	};

	using Connection = std::unique_ptr<PGconn, ConnectionCleanup>;
	using Result = std::unique_ptr<PGresult, ResultCleanup>;

	Connection Connect()
	{
		// An empty connection string tells libpq to use the standard PGHOST,
		// PGPORT, PGDATABASE, PGUSER, and password settings from the environment.
		Connection connection(PQconnectdb(""));
		if(!connection || PQstatus(connection.get()) != CONNECTION_OK)
		{
			const std::string message = connection ? PQerrorMessage(connection.get()) : "out of memory";
			throw std::runtime_error("PostgreSQL connection failed: " + message);
		}
		return connection;
	}

	Result Query(PGconn* connection)
	{
		Result result(PQexec(connection, "SELECT 'Hello from PostgreSQL' AS message"));
		if(!result || PQresultStatus(result.get()) != PGRES_TUPLES_OK)
		{
			throw std::runtime_error("PostgreSQL query failed: " + std::string(PQerrorMessage(connection)));
		}
		return result;
	}

	void Print(const PGresult* result)
	{
		for(int row = 0; row < PQntuples(result); ++row)
		{
			for(int column = 0; column < PQnfields(result); ++column)
			{
				if(column != 0)
				{
					std::cout << "\t";
				}
				std::cout << PQfname(result, column) << ": ";
				if(PQgetisnull(result, row, column))
				{
					std::cout << "NULL";
				}
				else
				{
					std::cout << PQgetvalue(result, row, column);
				}
			}
			std::cout << "\n";
		}
	}
}

int main()
{
	try
	{
		Connection connection = Connect();
		Result result = Query(connection.get());
		Print(result.get());
		return EXIT_SUCCESS;
	}
	catch(const std::exception& error)
	{
		std::cerr << error.what() << "\n";
		return EXIT_FAILURE;
	}
}
