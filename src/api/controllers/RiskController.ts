import { Request, Response } from 'express';
import { Body, Get, JsonController, Post, Put, QueryParams, Req, Param, Res } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  ReviewRiskPolicyVersionBody,
  RiskKillSwitchBody,
  RiskKillSwitchResult,
  RiskAccountsResponse,
  RiskPreTradeCheckBody,
  RiskPreTradeCheckResult,
  RiskOrdersResponse,
  RiskPositionsResponse,
  RiskAlertsResponse,
  RiskAssetSnapshotsResponse,
  RiskBrokerAssetSnapshotsResponse,
  RiskBrokerSnapshotsResponse,
  RiskControlsResponse,
  RiskPolicyContextsResponse,
  RiskScenariosResponse,
  RiskPoliciesResponse,
  RiskPolicyReviewResult,
  RiskRuleEvaluationsResponse,
  RiskPolicyVersionsResponse,
  RiskRecomputeResult,
  RiskSourceCoverageResponse,
  RiskPolicyWriteResult,
  RiskPolicyRollbackResult,
  RollbackRiskPolicyBody,
  UpsertRiskPolicyBody,
  RiskSummary,
} from '../contracts/Risk';
import { RiskPreTradeService } from '../services/RiskPreTradeService';
import { RiskService } from '../services/RiskService';
import {
  validateRiskPreTradeCheckBody,
  validateReviewRiskPolicyVersionBody,
  validateRollbackRiskPolicyBody,
  validateUpsertRiskPolicyBody
} from '../validators/risk.validator';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/risk')
@Service()
export class RiskController {
  @Inject(() => RiskService)
  private riskService!: RiskService;

  @Inject(() => RiskPreTradeService)
  private riskPreTradeService!: RiskPreTradeService;

  @Get('/summary')
  async getRiskSummary(@Req() request: Request): Promise<ApiSuccessResponse<RiskSummary>> {
    return this.riskService.getRiskSummary(requireAuthUserId(request));
  }

  @Get('/accounts')
  async getRiskAccounts(@Req() request: Request): Promise<ApiSuccessResponse<RiskAccountsResponse>> {
    return this.riskService.getRiskAccounts(requireAuthUserId(request));
  }

  @Get('/positions')
  async getRiskPositions(@Req() request: Request): Promise<ApiSuccessResponse<RiskPositionsResponse>> {
    return this.riskService.getRiskPositions(requireAuthUserId(request));
  }

  @Get('/orders')
  async getRiskOrders(@Req() request: Request): Promise<ApiSuccessResponse<RiskOrdersResponse>> {
    return this.riskService.getRiskOrders(requireAuthUserId(request));
  }

  @Get('/storage/brokers')
  async getRiskBrokerSnapshots(
    @Req() request: Request,
    @QueryParams() query: { snapshotId?: string }
  ): Promise<ApiSuccessResponse<RiskBrokerSnapshotsResponse>> {
    return this.riskService.getRiskBrokerSnapshots(requireAuthUserId(request), query.snapshotId);
  }

  @Get('/storage/assets')
  async getRiskAssetSnapshots(
    @Req() request: Request,
    @QueryParams() query: { snapshotId?: string }
  ): Promise<ApiSuccessResponse<RiskAssetSnapshotsResponse>> {
    return this.riskService.getRiskAssetSnapshots(requireAuthUserId(request), query.snapshotId);
  }

  @Get('/storage/broker-assets')
  async getRiskBrokerAssetSnapshots(
    @Req() request: Request,
    @QueryParams() query: { snapshotId?: string }
  ): Promise<ApiSuccessResponse<RiskBrokerAssetSnapshotsResponse>> {
    return this.riskService.getRiskBrokerAssetSnapshots(requireAuthUserId(request), query.snapshotId);
  }

  @Get('/storage/policy-contexts')
  async getRiskPolicyContexts(
    @Req() request: Request,
    @QueryParams() query: { snapshotId?: string }
  ): Promise<ApiSuccessResponse<RiskPolicyContextsResponse>> {
    return this.riskService.getRiskPolicyContexts(requireAuthUserId(request), query.snapshotId);
  }

  @Get('/storage/source-coverage')
  async getRiskSourceCoverage(
    @Req() request: Request,
    @QueryParams() query: { snapshotId?: string }
  ): Promise<ApiSuccessResponse<RiskSourceCoverageResponse>> {
    return this.riskService.getRiskSourceCoverage(requireAuthUserId(request), query.snapshotId);
  }

  @Get('/storage/rule-evaluations')
  async getRiskRuleEvaluations(
    @Req() request: Request,
    @QueryParams() query: { snapshotId?: string }
  ): Promise<ApiSuccessResponse<RiskRuleEvaluationsResponse>> {
    return this.riskService.getRiskRuleEvaluations(requireAuthUserId(request), query.snapshotId);
  }

  @Get('/snapshots/:snapshotId')
  async getRiskSnapshotDetail(
    @Req() request: Request,
    @Param('snapshotId') snapshotId: string,
    @Res() response: Response
  ): Promise<Response> {
    const payload = await this.riskService.getRiskSnapshotDetail(
      requireAuthUserId(request),
      snapshotId
    );

    return response.json(payload);
  }

  @Get('/alerts')
  async getRiskAlerts(
    @Req() request: Request,
    @QueryParams()
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskAlertsResponse>> {
    return this.riskService.getRiskAlerts(requireAuthUserId(request), query);
  }

  @Get('/controls')
  async getRiskControls(
    @Req() request: Request,
    @QueryParams()
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskControlsResponse>> {
    return this.riskService.getRiskControls(requireAuthUserId(request), query);
  }

  @Get('/scenarios')
  async getRiskScenarios(
    @Req() request: Request,
    @QueryParams()
    query: { limit?: string; offset?: string; status?: string; scope?: string }
  ): Promise<ApiSuccessResponse<RiskScenariosResponse>> {
    return this.riskService.getRiskScenarios(requireAuthUserId(request), query);
  }

  @Post('/kill-switch')
  async triggerKillSwitch(
    @Req() request: Request,
    @Body() body: RiskKillSwitchBody
  ): Promise<ApiSuccessResponse<RiskKillSwitchResult>> {
    return this.riskService.triggerKillSwitch(requireAuthUserId(request), body);
  }

  @Post('/recompute')
  async recomputeRiskSnapshot(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<RiskRecomputeResult>> {
    return this.riskService.recomputeRiskSnapshot(requireAuthUserId(request));
  }

  @Post('/pretrade/check')
  async createPreTradeCheck(
    @Req() request: Request,
    @Body() body: RiskPreTradeCheckBody
  ): Promise<ApiSuccessResponse<RiskPreTradeCheckResult>> {
    return this.riskPreTradeService.createPreTradeCheck(
      requireAuthUserId(request),
      validateRiskPreTradeCheckBody(body)
    );
  }

  @Get('/pretrade/checks/:checkId')
  async getPreTradeCheck(
    @Req() request: Request,
    @Param('checkId') checkId: string
  ): Promise<ApiSuccessResponse<RiskPreTradeCheckResult>> {
    return this.riskPreTradeService.getPreTradeCheck(requireAuthUserId(request), checkId);
  }

  @Get('/policies')
  async getRiskPolicies(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<RiskPoliciesResponse>> {
    return this.riskService.getRiskPolicies(requireAuthUserId(request));
  }

  @Post('/policies')
  async createRiskPolicy(
    @Req() request: Request,
    @Body() body: Partial<UpsertRiskPolicyBody>
  ): Promise<ApiSuccessResponse<RiskPolicyWriteResult>> {
    return this.riskService.createRiskPolicy(
      requireAuthUserId(request),
      requireAuthUserId(request),
      validateUpsertRiskPolicyBody(body)
    );
  }

  @Put('/policies/:policyId')
  async updateRiskPolicy(
    @Req() request: Request,
    @Param('policyId') policyId: string,
    @Body() body: Partial<UpsertRiskPolicyBody>
  ): Promise<ApiSuccessResponse<RiskPolicyWriteResult>> {
    return this.riskService.updateRiskPolicy(
      requireAuthUserId(request),
      requireAuthUserId(request),
      policyId,
      validateUpsertRiskPolicyBody(body)
    );
  }

  @Get('/policies/:policyId/versions')
  async getRiskPolicyVersions(
    @Req() request: Request,
    @Param('policyId') policyId: string
  ): Promise<ApiSuccessResponse<RiskPolicyVersionsResponse>> {
    return this.riskService.getRiskPolicyVersions(requireAuthUserId(request), policyId);
  }

  @Post('/policies/:policyId/rollback')
  async rollbackRiskPolicy(
    @Req() request: Request,
    @Param('policyId') policyId: string,
    @Body() body: RollbackRiskPolicyBody
  ): Promise<ApiSuccessResponse<RiskPolicyRollbackResult>> {
    return this.riskService.rollbackRiskPolicy(
      requireAuthUserId(request),
      requireAuthUserId(request),
      policyId,
      validateRollbackRiskPolicyBody(body)
    );
  }

  @Post('/policies/:policyId/versions/:versionId/approve')
  async approveRiskPolicyVersion(
    @Req() request: Request,
    @Param('policyId') policyId: string,
    @Param('versionId') versionId: string,
    @Body() body: ReviewRiskPolicyVersionBody
  ): Promise<ApiSuccessResponse<RiskPolicyReviewResult>> {
    return this.riskService.approveRiskPolicyVersion(
      requireAuthUserId(request),
      requireAuthUserId(request),
      policyId,
      versionId,
      validateReviewRiskPolicyVersionBody(body)
    );
  }

  @Post('/policies/:policyId/versions/:versionId/reject')
  async rejectRiskPolicyVersion(
    @Req() request: Request,
    @Param('policyId') policyId: string,
    @Param('versionId') versionId: string,
    @Body() body: ReviewRiskPolicyVersionBody
  ): Promise<ApiSuccessResponse<RiskPolicyReviewResult>> {
    return this.riskService.rejectRiskPolicyVersion(
      requireAuthUserId(request),
      requireAuthUserId(request),
      policyId,
      versionId,
      validateReviewRiskPolicyVersionBody(body)
    );
  }
}
