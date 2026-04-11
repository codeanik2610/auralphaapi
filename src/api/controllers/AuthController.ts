import { Body, Get, JsonController, Post, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AuthSessionResponse,
  AuthTokensResponse,
  AuthUserResponse,
  LoginBody,
  LogoutAllSessionsResponse,
  LogoutBody,
  RefreshBody
} from '../contracts/Auth';
import { AuthService } from '../services/AuthService';

@JsonController('/auth')
@Service()
export class AuthController {
  @Inject(() => AuthService)
  private authService!: AuthService;

  @Post('/login')
  async login(
    @Body() body: LoginBody,
    @Req() request: Request
  ): Promise<ApiSuccessResponse<AuthTokensResponse>> {
    return this.authService.login(body, request);
  }

  @Post('/refresh')
  async refresh(
    @Body() body: RefreshBody,
    @Req() request: Request
  ): Promise<ApiSuccessResponse<AuthTokensResponse>> {
    return this.authService.refresh(body, request);
  }

  @Post('/logout')
  async logout(
    @Body() body: LogoutBody
  ): Promise<ApiSuccessResponse<{ revoked: true }>> {
    return this.authService.logout(body);
  }

  @Get('/sessions')
  async sessions(@Req() request: Request): Promise<ApiSuccessResponse<AuthSessionResponse[]>> {
    return this.authService.listSessions(request);
  }

  @Post('/logout-all')
  async logoutAll(@Req() request: Request): Promise<ApiSuccessResponse<LogoutAllSessionsResponse>> {
    return this.authService.logoutAll(request);
  }

  @Get('/me')
  async me(@Req() request: Request): Promise<ApiSuccessResponse<AuthUserResponse>> {
    return this.authService.me(request);
  }
}
