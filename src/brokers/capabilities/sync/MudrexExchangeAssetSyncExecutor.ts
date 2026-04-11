import { Inject, Service } from 'typedi';
import { BadRequestAppError, NotFoundAppError } from '../../../api';
import { MudrexApiError } from '../../providers/mudrex/MudrexHttpClient';
import { MudrexService } from '../../providers/mudrex/MudrexService';
import { Logger } from '../../../lib/logger';
import { ExchangeAssetSyncCandidate, ExchangeAssetSyncExecutor, ExchangeAssetSyncMatch } from './ExchangeAssetSyncService';

const log = new Logger(__filename);

@Service()
export class MudrexExchangeAssetSyncExecutor implements ExchangeAssetSyncExecutor {
  readonly key = 'mudrex-assets';

  @Inject(() => MudrexService)
  private mudrexService!: MudrexService;

  async execute(assets: ExchangeAssetSyncCandidate[]): Promise<ExchangeAssetSyncMatch[]> {
    const matchedAssets: ExchangeAssetSyncMatch[] = [];

    for (const assetRecord of assets) {
      try {
        const asset = await this.mudrexService.fetchRemoteFuturesAssetBySymbolOrThrow(assetRecord.symbol);
        matchedAssets.push({
          externalId: asset.id,
          assetId: assetRecord.id,
          name: asset.name,
          symbol: asset.symbol,
        });
      } catch (error) {
        if (this.shouldSkipSymbol(error)) {
          log.warn(
            `Skipping broker asset sync for symbol ${assetRecord.symbol}: ${error instanceof Error ? error.message : String(error)}`
          );
          continue;
        }

        throw error;
      }
    }

    return matchedAssets;
  }

  private shouldSkipSymbol(error: unknown): boolean {
    if (error instanceof NotFoundAppError || error instanceof BadRequestAppError) {
      return true;
    }

    if (!(error instanceof MudrexApiError)) {
      return false;
    }

    const message = error.message.toLowerCase();

    if (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 429) {
      return false;
    }

    return (
      error.statusCode === 400 ||
      error.statusCode === 404 ||
      error.statusCode === 422 ||
      error.statusCode === 502 ||
      message === 'asset not found' ||
      message === 'something went wrong'
    );
  }
}
