import { Request } from 'express';
import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  EmailDeliveryActionResult,
  EmailDeliveryBulkActionResult,
  EmailDeliveryBulkPreviewResult,
  EmailDeliveryCleanupActivityItem,
  EmailDeliveryCleanupResult,
  EmailDeliveryCleanupPreviewResult,
  EmailDeliveryFilterOptions,
  EmailDeliveryExportBody,
  EmailDeliveryExportResult,
  EmailDeliveryMatchingCleanupPreviewResult,
  EmailDeliveryMatchingCleanupResult,
  EmailDeliveriesListResponse,
  EmailDeliveriesSummary,
  EmailDeliveryItem,
} from '../contracts/EmailDelivery';
import { EmailDeliveriesService } from '../services/EmailDeliveriesService';
import { requireAdminAuthUser } from '../utils/auth';

@JsonController('/email-deliveries')
@Service()
export class EmailDeliveriesController {
  @Inject(() => EmailDeliveriesService)
  private emailDeliveriesService!: EmailDeliveriesService;

  @Get()
  async getEmailDeliveries(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('userId') userId?: string,
    @QueryParam('recipient') recipient?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string,
    @QueryParam('source') source?: string
  ): Promise<ApiSuccessResponse<EmailDeliveriesListResponse>> {
    return this.emailDeliveriesService.getEmailDeliveries(requireAdminAuthUser(request), {
      limit,
      offset,
      status,
      search,
      userId,
      recipient,
      severity,
      channel,
      source,
    });
  }

  @Get('/summary')
  async getEmailDeliveriesSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<EmailDeliveriesSummary>> {
    return this.emailDeliveriesService.getEmailDeliveriesSummary(requireAdminAuthUser(request));
  }

  @Get('/filter-options')
  async getEmailDeliveryFilterOptions(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<EmailDeliveryFilterOptions>> {
    return this.emailDeliveriesService.getEmailDeliveryFilterOptions(
      requireAdminAuthUser(request)
    );
  }

  @Post('/export')
  async exportEmailDeliveries(
    @Req() request: Request,
    @Body() body: EmailDeliveryExportBody
  ): Promise<ApiSuccessResponse<EmailDeliveryExportResult>> {
    return this.emailDeliveriesService.exportEmailDeliveries(
      requireAdminAuthUser(request),
      body
    );
  }

  @Get('/retry-failed/matching/preview')
  async previewMatchingFailedEmailDeliveries(
    @Req() request: Request,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('userId') userId?: string,
    @QueryParam('recipient') recipient?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string,
    @QueryParam('source') source?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryBulkPreviewResult>> {
    return this.emailDeliveriesService.previewMatchingFailedEmailDeliveries(
      requireAdminAuthUser(request),
      {
        status,
        search,
        userId,
        recipient,
        severity,
        channel,
        source,
      }
    );
  }

  @Post('/retry-failed')
  async retryAllFailedEmailDeliveries(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<EmailDeliveryBulkActionResult>> {
    return this.emailDeliveriesService.retryAllFailedEmailDeliveries(
      requireAdminAuthUser(request)
    );
  }

  @Post('/retry-failed/matching')
  async retryMatchingFailedEmailDeliveries(
    @Req() request: Request,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('userId') userId?: string,
    @QueryParam('recipient') recipient?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string,
    @QueryParam('source') source?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryBulkActionResult>> {
    return this.emailDeliveriesService.retryMatchingFailedEmailDeliveries(
      requireAdminAuthUser(request),
      {
        status,
        search,
        userId,
        recipient,
        severity,
        channel,
        source,
      }
    );
  }

  @Get('/cleanup-preview')
  async previewCleanupEmailDeliveries(
    @Req() request: Request,
    @QueryParam('retentionDays') retentionDays?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryCleanupPreviewResult>> {
    return this.emailDeliveriesService.previewCleanupEmailDeliveries(
      requireAdminAuthUser(request),
      retentionDays
    );
  }

  @Get('/cleanup/matching/preview')
  async previewMatchingCleanupEmailDeliveries(
    @Req() request: Request,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('userId') userId?: string,
    @QueryParam('recipient') recipient?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string,
    @QueryParam('source') source?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryMatchingCleanupPreviewResult>> {
    return this.emailDeliveriesService.previewMatchingCleanupEmailDeliveries(
      requireAdminAuthUser(request),
      {
        status,
        search,
        userId,
        recipient,
        severity,
        channel,
        source,
      }
    );
  }

  @Get('/cleanup/latest')
  async getLatestCleanupActivity(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<EmailDeliveryCleanupActivityItem | null>> {
    return this.emailDeliveriesService.getLatestCleanupActivity(requireAdminAuthUser(request));
  }

  @Get('/:deliveryId')
  async getEmailDeliveryById(
    @Req() request: Request,
    @Param('deliveryId') deliveryId: string
  ): Promise<ApiSuccessResponse<EmailDeliveryItem>> {
    return this.emailDeliveriesService.getEmailDeliveryById(
      requireAdminAuthUser(request),
      deliveryId
    );
  }

  @Post('/cleanup')
  async cleanupEmailDeliveries(
    @Req() request: Request,
    @QueryParam('retentionDays') retentionDays?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryCleanupResult>> {
    return this.emailDeliveriesService.cleanupEmailDeliveries(
      requireAdminAuthUser(request),
      retentionDays
    );
  }

  @Post('/cleanup/matching')
  async cleanupMatchingEmailDeliveries(
    @Req() request: Request,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('userId') userId?: string,
    @QueryParam('recipient') recipient?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string,
    @QueryParam('source') source?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryMatchingCleanupResult>> {
    return this.emailDeliveriesService.cleanupMatchingEmailDeliveries(
      requireAdminAuthUser(request),
      {
        status,
        search,
        userId,
        recipient,
        severity,
        channel,
        source,
      }
    );
  }

  @Post('/test')
  async sendTestEmailDelivery(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<EmailDeliveryActionResult>> {
    return this.emailDeliveriesService.sendTestEmailDelivery(requireAdminAuthUser(request));
  }

  @Post('/:deliveryId/retry')
  async retryEmailDelivery(
    @Req() request: Request,
    @Param('deliveryId') deliveryId: string
  ): Promise<ApiSuccessResponse<EmailDeliveryActionResult>> {
    return this.emailDeliveriesService.retryEmailDelivery(
      requireAdminAuthUser(request),
      deliveryId
    );
  }

  @Post('/:deliveryId/resend')
  async resendEmailDelivery(
    @Req() request: Request,
    @Param('deliveryId') deliveryId: string
  ): Promise<ApiSuccessResponse<EmailDeliveryActionResult>> {
    return this.emailDeliveriesService.resendEmailDelivery(
      requireAdminAuthUser(request),
      deliveryId
    );
  }
}
