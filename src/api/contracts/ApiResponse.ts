export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  statusCode: number;
  code?: string;
  message: string;
  timestamp: string;
  path: string;
}
