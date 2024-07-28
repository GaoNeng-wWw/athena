export enum QueryType {
  GET,
  HGET,
  SHAS
}
export interface Query {
  type: QueryType;
  data: Record<string, string>
}
export interface ClientQueryResponse<T> {
  status: boolean;
  leaderHint: string;
  response: T;
}
export interface ClientRequestResponse{
  status: boolean;
  leaderHint: string;
}