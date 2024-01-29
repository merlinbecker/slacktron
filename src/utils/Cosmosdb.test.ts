import { CosmosConfig, CosmosDB } from './Cosmosdb';

// Function to create the mocked implementation with a custom result
const createMockedCosmosClient = (result: any) => {
  const mockFetchAll = jest.fn().mockResolvedValue(
    {
      resources: result,
    });

  const mockQuery = jest.fn().mockImplementation(() => ({
    fetchAll: mockFetchAll,
  }));
  const mockReplace = jest.fn()
  const mockItem = jest.fn().mockImplementation(() => ({
    replace: mockReplace
  }));

  const mockCreate = jest.fn()
  const mockContainer = {
    items: {
      query: mockQuery,
      create: mockCreate
    },
    item: mockItem
  };

  const mockDatabase = {
    container: jest.fn().mockReturnValue(mockContainer),
  };

  const mockCosmosClient = {
    database: jest.fn().mockReturnValue(mockDatabase),
  };

  jest.mock('@azure/cosmos', () => ({
    CosmosClient: jest.fn(() => {
      return mockCosmosClient
    }),
  }));

  return {
    mockFetchAll,
    mockQuery,
    mockCreate,
    mockReplace,
    mockContainer,
    mockDatabase,
    mockCosmosClient,
  }

};
const response = () => "worked"

describe('cosmosDB Wrapper tests', () => {
  // Your test code here
  test('cosmos db test, id not in database', async () => {
    // Create the mocked implementation with a specific result
    const cosmosresponse = []
    const mocks = createMockedCosmosClient(cosmosresponse)
    const creds: CosmosConfig = ({
      key: "TestKey",
      endpoint: "TestEndpoint",
      database: "TestDatabase",
      container: "TestContainer"
    })
    creds.client = mocks.mockCosmosClient

    const cosmosclient = new CosmosDB(creds)
    await cosmosclient.init("Test")

    // Your actual test code that uses the mocked implementation
    const actualResult = await cosmosclient.preCheckAndProcess({
      callback: response,
      userid: "testuser",
      identifier: "test",
      messagetext: "hi"
    });

    // Assert the result
    expect(actualResult).toEqual(response())

    // Verify that the methods were called as expected
    expect(mocks.mockFetchAll).toHaveBeenCalledTimes(1);
    expect(mocks.mockContainer.items.create).toHaveBeenCalledTimes(1);
    expect(mocks.mockContainer.items.query).toHaveBeenCalledTimes(1);

    expect(mocks.mockDatabase.container).toHaveBeenCalledTimes(1);
    expect(mocks.mockCosmosClient.database).toHaveBeenCalledTimes(1);
  })
  test('cosmos db test, id already in database', async () => {
    // Create the mocked implementation with a specific result
    const cosmosresponse = [{ id: "test" }]
    const mocks = createMockedCosmosClient(cosmosresponse)
    const creds: CosmosConfig = ({
      key: "TestKey",
      endpoint: "TestEndpoint",
      database: "TestDatabase",
      container: "TestContainer"
    })
    creds.client = mocks.mockCosmosClient

    const cosmosclient = new CosmosDB(creds)
    await cosmosclient.init("Test")

    // Your actual test code that uses the mocked implementation
    const actualResult = await cosmosclient.preCheckAndProcess({
      callback: response,
      identifier: "test",
      messagetext: "hi",
      userid: "testuser"
    });

    // Assert the result
    expect(actualResult).toEqual(null)

    // Verify that the methods were called as expected
    expect(mocks.mockFetchAll).toHaveBeenCalledTimes(1);
    expect(mocks.mockReplace).toHaveBeenCalledTimes(1);
    expect(mocks.mockContainer.items.query).toHaveBeenCalledTimes(1);

    expect(mocks.mockDatabase.container).toHaveBeenCalledTimes(1);
    expect(mocks.mockCosmosClient.database).toHaveBeenCalledTimes(1);
  })
})