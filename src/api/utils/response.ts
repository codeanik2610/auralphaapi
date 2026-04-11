import { ApiSuccessResponse } from '../contracts/ApiResponse';

export const successResponse = <T>(data: T): ApiSuccessResponse<T> => ({
  success: true,
  data,
});
