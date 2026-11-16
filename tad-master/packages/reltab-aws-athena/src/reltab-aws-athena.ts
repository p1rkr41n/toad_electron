import {
  Schema,
  DataSourceConnection,
  DataSourceProvider,
  registerProvider,
  DbDriver,
  SQLDialect,
  DbDataSource,
  ColumnStatsMap,
  LeafSchemaMap,
  Row,
  DataSourceId,
  PrestoDialect,
  DataSourceNode,
  DataSourcePath,
} from "reltab";

const AWS_ATHENA_DEPRECATED_ERROR =
  "AWS Athena legacy driver is deprecated; use DuckDB httpfs/S3 or Parquet instead.";

export class AWSAthenaDriver implements DbDriver {
  readonly sourceId: DataSourceId;
  readonly dialect: SQLDialect = PrestoDialect;
  tableMap: LeafSchemaMap;

  constructor() {
    this.sourceId = {
      providerName: "aws-athena",
      resourceId: "",
    };
    this.tableMap = {};
  }

  async getDisplayName(): Promise<string> {
    return "AWS Athena";
  }

  async runSqlQuery(_sqlQuery: string): Promise<Row[]> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async importCsv(): Promise<void> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async getTableSchema(_tableName: string): Promise<Schema> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async getSqlQuerySchema(_sqlQuery: string): Promise<Schema> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async getSqlQueryColumnStatsMap(_sqlQuery: string): Promise<ColumnStatsMap> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async getRootNode(): Promise<DataSourceNode> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async getChildren(_dsPath: DataSourcePath): Promise<DataSourceNode[]> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }

  async getTableName(_dsPath: DataSourcePath): Promise<string> {
    throw new Error(AWS_ATHENA_DEPRECATED_ERROR);
  }
}

const awsAthenaDataSourceProvider: DataSourceProvider = {
  providerName: "aws-athena",
  connect: async (_resourceId: any): Promise<DataSourceConnection> => {
    const driver = new AWSAthenaDriver();
    const dsConn = new DbDataSource(driver);
    return dsConn;
  },
};

registerProvider(awsAthenaDataSourceProvider);
