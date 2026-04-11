import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import { MudrexAsset, MudrexAssetDetail } from '../../../api';
import { BadGatewayAppError } from '../../../api';
import { successResponse } from '../../../api';
import {
  RemoteFuturesQuery,
  validateAssetId,
  validateAssetSymbol,
  validateRemoteFuturesQuery,
} from '../../../api/validators/assets.validator';
import { BrokerAccountRepository } from '../../../database';
import { decryptBrokerAccountSettings } from '../../../lib/brokerAccountSecrets';
import { rethrowMudrexError } from './MudrexErrorMapper';
import { MudrexHttpClient } from './MudrexHttpClient';

@Service()
export class MudrexService {
  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  async getRemoteFutures(query: RemoteFuturesQuery): Promise<ApiSuccessResponse<MudrexAsset[]>> {
    const params = validateRemoteFuturesQuery(query);

    try {
      const data = await this.fetchPage(params.offset, params.limit, params.sort, params.order);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex futures service');
    }
  }

  async getRemoteFuturesAsset(assetId: string): Promise<ApiSuccessResponse<MudrexAssetDetail>> {
    const validatedAssetId = validateAssetId(assetId);

    try {
      const data = await this.fetchAsset(validatedAssetId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex futures asset service');
    }
  }

  async getRemoteFuturesAssetBySymbol(
    symbol: string
  ): Promise<ApiSuccessResponse<MudrexAssetDetail>> {
    const validatedSymbol = validateAssetSymbol(symbol);

    try {
      const data = await this.fetchAssetBySymbol(validatedSymbol);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex futures symbol service');
    }
  }

  async fetchRemoteFuturesAssetBySymbolOrThrow(symbol: string): Promise<MudrexAssetDetail> {
    const validatedSymbol = validateAssetSymbol(symbol);
    return this.fetchAssetBySymbol(validatedSymbol);
  }

  async fetchAllRemoteFuturesOrThrow(pageSize = 200): Promise<MudrexAsset[]> {
    return this.fetchAllRemoteFuturesForUserOrThrow(pageSize);
  }

  async fetchAllRemoteFuturesForUserOrThrow(
    pageSize = 200,
    userId?: string
  ): Promise<MudrexAsset[]> {
    try {
      const allAssets: MudrexAsset[] = [];
      let offset = 0;

      while (true) {
        const batch = await this.fetchPage(offset, pageSize, undefined, undefined, userId);
        if (!Array.isArray(batch) || batch.length === 0) {
          break;
        }

        allAssets.push(...batch);

        if (batch.length < pageSize) {
          break;
        }

        offset += pageSize;

        if (offset >= 20000) {
          break;
        }
      }

      return allAssets;
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex futures service');
    }
  }

  private async fetchPage(
    offset: number,
    limit: number,
    sort?: string,
    order?: 'asc' | 'desc',
    userId?: string
  ): Promise<MudrexAsset[]> {
    const payload = await this.requestFutures<MudrexAsset[]>('/fapi/v1/futures', {
      offset,
      limit,
      ...(sort ? { sort } : {}),
      ...(order ? { order } : {}),
    }, userId);
    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Mudrex returned an invalid futures payload');
    }
    return payload;
  }

  private async fetchAsset(assetId: string): Promise<MudrexAssetDetail> {
    const payload = await this.requestFutures<MudrexAssetDetail>(
      `/fapi/v1/futures/${encodeURIComponent(assetId)}`
    );
    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid futures asset payload');
    }
    return payload;
  }

  private async fetchAssetBySymbol(symbol: string): Promise<MudrexAssetDetail> {
    const payload = await this.requestFutures<MudrexAssetDetail>(
      `/fapi/v1/futures/${encodeURIComponent(symbol)}?is_symbol`
    );
    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid futures asset payload');
    }
    return payload;
  }

  private async requestFutures<T>(
    path: string,
    query?: Record<string, string | number>,
    userId?: string
  ): Promise<T> {
    const settings = await this.getPreferredMudrexSettings(userId);
    if (settings) {
      return this.mudrexHttpClient.authenticatedGetWithSettings<T>(settings, path, query, 'mudrex');
    }
    return this.mudrexHttpClient.get<T>(path, query);
  }

  private async getPreferredMudrexSettings(
    userId?: string
  ): Promise<Record<string, unknown> | null> {
    const normalizedUserId = String(userId || '').trim();

    if (normalizedUserId) {
      const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
        normalizedUserId,
        'mudrex'
      );

      for (const account of activeAccounts) {
        const decrypted = decryptBrokerAccountSettings(
          ((account.settings ?? {}) as Record<string, unknown>)
        );
        if (decrypted && String(decrypted.apiSecret || '').trim()) {
          return decrypted;
        }
      }
    }

    return this.getSystemMudrexSettings();
  }

  private async getSystemMudrexSettings(): Promise<Record<string, unknown> | null> {
    const systemAccounts = await this.brokerAccountRepository.listSystemBrokerAccounts({
      brokerKey: 'mudrex',
      statuses: ['Connected', 'Idle'],
    });
    for (const account of systemAccounts) {
      const decrypted = decryptBrokerAccountSettings(
        ((account.settings ?? {}) as Record<string, unknown>)
      );
      if (decrypted && String(decrypted.apiSecret || '').trim()) {
        return decrypted;
      }
    }
    return null;
  }
}
