import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerDefinitionItem,
  BrokerDefinitionsResponse,
  BrokerDefinitionUpsertBody,
} from '../contracts/BrokerDefinition';
import { successResponse } from '../utils/response';
import {
  ValidatedBrokerDefinitionUpsertBody,
  validateBrokerDefinitionUpsertBody,
} from '../validators/brokerDefinitions.validator';
import {
  BrokerDefinitionRuntimeSupportService,
  BrokerDefinitionService,
} from '../../brokers';
import { BrokerRepository } from '../../database';
import { OperationalEventService } from './OperationalEventService';
import { Logger } from '../../lib/logger';
import { BadRequestAppError, ConflictAppError, ForbiddenAppError } from '../errors/AppError';
import { AuthUserContext } from '../utils/auth';

const log = new Logger(__filename);

type ComparableBrokerDefinition = {
  brokerKey: string;
  name: string;
  category: string;
  status: string;
  providerType: string;
  linkedExchangeKey: string | null;
  baseUrl: string | null;
  capabilities: string[];
  accountFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    secret: boolean;
    placeholder: string | null;
    helpText: string | null;
    options: Array<{
      value: string;
      label: string;
    }>;
  }>;
  integrationGuide: {
    summary: string | null;
    docsUrl: string | null;
    notes: string[];
    steps: Array<{
      title: string;
      description: string;
    }>;
  } | null;
  diagnostics: {
    requiresAccount: boolean;
    executorKey: string | null;
    successStatus: string;
    failureStatus: string;
    resetStatus: string;
  } | null;
};

function getHttpErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('httpCode' in error)) {
    return undefined;
  }

  const { httpCode } = error as { httpCode?: unknown };
  return typeof httpCode === 'number' ? httpCode : undefined;
}

@Service()
export class BrokerDefinitionsService {
  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => BrokerRepository)
  private brokerRepository!: BrokerRepository;

  @Inject(() => BrokerDefinitionRuntimeSupportService)
  private brokerDefinitionRuntimeSupportService!: BrokerDefinitionRuntimeSupportService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async listDefinitions(auth: AuthUserContext): Promise<ApiSuccessResponse<BrokerDefinitionsResponse>> {
    this.requireAdmin(auth);
    const definitions = await this.brokerDefinitionService.listPersistedDefinitions({
      includeInactive: true,
    });

    return successResponse({
      items: definitions.map((item) => this.mapDefinition(item)),
      total: definitions.length,
    });
  }

  async getDefinition(auth: AuthUserContext, brokerKey: string): Promise<ApiSuccessResponse<BrokerDefinitionItem>> {
    this.requireAdmin(auth);
    const definition = await this.brokerDefinitionService.getPersistedDefinition(brokerKey, {
      includeInactive: true,
    });
    return successResponse(this.mapDefinition(definition));
  }

  async upsertDefinition(
    auth: AuthUserContext,
    body: BrokerDefinitionUpsertBody
  ): Promise<ApiSuccessResponse<BrokerDefinitionItem>> {
    this.requireAdmin(auth);
    const { userId } = auth;
    const attemptedBrokerKey = String(body?.brokerKey || '').trim();
    try {
      const payload = validateBrokerDefinitionUpsertBody(body);
      this.assertPersistableBrokerKey(payload.brokerKey);
      await this.brokerDefinitionRuntimeSupportService.validateDefinition(payload);
      const existing = await this.brokerRepository.getBrokerByKey(payload.brokerKey);
      const existingByName = await this.brokerRepository.getBrokerByName(payload.name);
      const expectedUpdatedAt = payload.expectedUpdatedAt;

      if (existingByName && existingByName.id !== existing?.id) {
        throw new ConflictAppError(
          `Broker definition name already exists: ${payload.name}. Use a different broker name.`
        );
      }

      if (expectedUpdatedAt === null && existing) {
        throw new ConflictAppError(
          `Broker definition already exists for key: ${payload.brokerKey}. Reload the latest definition before saving.`
        );
      }

      if (typeof expectedUpdatedAt === 'string') {
        if (!existing) {
          throw new ConflictAppError(
            `Broker definition changed elsewhere for key: ${payload.brokerKey}. Reload and try again.`
          );
        }
        if (existing.updatedAt.toISOString() !== expectedUpdatedAt) {
          throw new ConflictAppError(
            `Broker definition was updated elsewhere for key: ${payload.brokerKey}. Reload and try again.`
          );
        }
      }

      const existingDefinition = existing
        ? await this.brokerDefinitionService.getPersistedDefinition(payload.brokerKey, {
            includeInactive: true,
          })
        : null;

      if (existingDefinition && this.isUnchangedDefinition(existingDefinition, payload)) {
        return successResponse(this.mapDefinition(existingDefinition));
      }

      const saved = await this.brokerRepository.saveBrokerDefinition({
        id: existing?.id,
        brokerKey: payload.brokerKey,
        name: payload.name,
        category: payload.category,
        status: payload.status,
        providerType: payload.providerType,
        linkedExchangeKey: payload.linkedExchangeKey ?? null,
        baseUrl: payload.baseUrl ?? existing?.baseUrl ?? null,
        capabilities: payload.capabilities,
        accountConfig: {
          fields: payload.accountFields,
        },
        integrationGuide: this.normalizeIntegrationGuide(payload.integrationGuide),
        diagnosticsConfig: this.normalizeDiagnostics(payload.diagnostics),
      }, {
        expectedUpdatedAt,
      });

      if (!saved) {
        throw new ConflictAppError(
          `Broker definition changed elsewhere for key: ${payload.brokerKey}. Reload and try again.`
        );
      }

      const definition = await this.loadPersistedDefinitionResponse(saved, payload, existing);

      log.info(
        `Broker definition updated for ${definition.brokerKey}: status=${definition.status}, providerType=${definition.providerType}, capabilities=${definition.capabilities.join(',') || '--'}`
      );
      await this.logSuccessfulUpsertActivity(userId, definition);

      return successResponse(definition);
    } catch (rawError) {
      const error = this.normalizeUpsertError(rawError, body);
      await this.operationalEventService.logActivity(userId, {
        type: 'Broker definition',
        title: `Broker definition update failed${attemptedBrokerKey ? `: ${attemptedBrokerKey}` : ''}`,
        status: 'Failed',
        route: 'Broker definitions',
        stream: 'Controls',
        related: attemptedBrokerKey || 'broker-definition',
        description: error instanceof Error ? error.message : String(error),
      });
      const httpCode = getHttpErrorCode(error);
      const isClientError = httpCode !== undefined && httpCode >= 400 && httpCode < 500;
      if (!isClientError) {
        await this.operationalEventService.emitFailureAlert(userId, {
          channel: 'Broker definitions',
          source: attemptedBrokerKey || 'broker-definition',
          message: `Broker definition update failed (${attemptedBrokerKey || 'broker-definition'}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          route: 'Risk review',
        });
      }
      throw error;
    }
  }

  private async loadPersistedDefinitionResponse(
    saved: { id: string; brokerKey: string; updatedAt?: Date | string },
    payload: ValidatedBrokerDefinitionUpsertBody,
    existing?: { baseUrl?: string | null } | null
  ): Promise<BrokerDefinitionItem> {
    try {
      const definition = await this.brokerDefinitionService.getPersistedDefinition(saved.brokerKey, {
        includeInactive: true,
      });
      return this.mapDefinition(definition);
    } catch (error) {
      log.warn(
        `Broker definition saved for ${saved.brokerKey}, but canonical reload failed. Falling back to the persisted payload response.`,
        error instanceof Error ? error.message : String(error)
      );

      return {
        id: saved.id,
        brokerKey: payload.brokerKey,
        name: payload.name,
        category: payload.category,
        status: payload.status,
        providerType: payload.providerType,
        linkedExchangeKey: payload.linkedExchangeKey,
        baseUrl: payload.baseUrl ?? existing?.baseUrl ?? undefined,
        capabilities: payload.capabilities,
        accountFields: payload.accountFields,
        integrationGuide: this.normalizeIntegrationGuide(payload.integrationGuide) as BrokerDefinitionItem['integrationGuide'],
        diagnostics: this.normalizeDiagnostics(payload.diagnostics) as BrokerDefinitionItem['diagnostics'],
        updatedAt:
          saved.updatedAt instanceof Date
            ? saved.updatedAt.toISOString()
            : typeof saved.updatedAt === 'string'
              ? new Date(saved.updatedAt).toISOString()
              : undefined,
        versionToken:
          saved.updatedAt instanceof Date
            ? saved.updatedAt.toISOString()
            : typeof saved.updatedAt === 'string'
              ? new Date(saved.updatedAt).toISOString()
              : undefined,
      };
    }
  }

  private async logSuccessfulUpsertActivity(
    userId: string,
    definition: BrokerDefinitionItem
  ): Promise<void> {
    try {
      await this.operationalEventService.logActivity(userId, {
        type: 'Broker definition',
        title: `Broker definition updated: ${definition.brokerKey}`,
        status: 'Success',
        route: 'Broker definitions',
        stream: 'Controls',
        related: definition.brokerKey,
        description: `Updated definition with status=${definition.status}, providerType=${definition.providerType}`,
      });
    } catch (error) {
      log.warn(
        `Broker definition saved for ${definition.brokerKey}, but activity logging failed.`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private mapDefinition(definition: Awaited<ReturnType<BrokerDefinitionService['getRequiredDefinition']>>): BrokerDefinitionItem {
    return {
      id: definition.id,
      brokerKey: definition.brokerKey,
      name: definition.name,
      category: definition.category,
      status: definition.status,
      providerType: definition.providerType,
      linkedExchangeKey: definition.linkedExchangeKey,
      baseUrl: definition.baseUrl,
      capabilities: definition.capabilities,
      accountFields: definition.accountFields,
      integrationGuide: definition.integrationGuide,
      diagnostics: definition.diagnostics,
      updatedAt: definition.updatedAt,
      versionToken: definition.versionToken,
    };
  }

  private requireAdmin(auth: AuthUserContext): void {
    if (String(auth?.role || '').toLowerCase() !== 'admin') {
      throw new ForbiddenAppError('Admin role is required to manage broker definitions');
    }
  }

  private assertPersistableBrokerKey(brokerKey: string): void {
    if (this.brokerDefinitionService.isSystemManagedBrokerKey(brokerKey)) {
      throw new BadRequestAppError(
        `Exchange-managed feed definitions cannot be edited in broker definitions: ${brokerKey}`
      );
    }
  }

  private normalizeUpsertError(
    error: unknown,
    body: BrokerDefinitionUpsertBody
  ): unknown {
    const attemptedName = String(body?.name || '').trim();

    if (this.brokerRepository.isDuplicateBrokerNameError(error)) {
      return new ConflictAppError(
        `Broker definition name already exists: ${attemptedName || 'Unnamed broker'}. Use a different broker name.`
      );
    }

    if (this.brokerRepository.isDuplicateBrokerKeyError(error)) {
      return new ConflictAppError(
        `Broker definition already exists for key: ${String(body?.brokerKey || '').trim() || 'unknown'}. Reload the latest definition before saving.`
      );
    }

    return error;
  }

  private isUnchangedDefinition(
    existing: Awaited<ReturnType<BrokerDefinitionService['getDefinition']>>,
    payload: ValidatedBrokerDefinitionUpsertBody
  ): boolean {
    return JSON.stringify(this.toComparableDefinitionFromDefinition(existing)) ===
      JSON.stringify(this.toComparableDefinitionFromPayload(payload, existing.baseUrl));
  }

  private toComparableDefinitionFromDefinition(
    definition: Awaited<ReturnType<BrokerDefinitionService['getDefinition']>>
  ): ComparableBrokerDefinition {
    return {
      brokerKey: String(definition.brokerKey || '').trim(),
      name: String(definition.name || '').trim(),
      category: String(definition.category || '').trim().toLowerCase(),
      status: String(definition.status || '').trim().toLowerCase(),
      providerType: String(definition.providerType || '').trim().toLowerCase(),
      linkedExchangeKey: String(definition.linkedExchangeKey || '').trim() || null,
      baseUrl: String(definition.baseUrl || '').trim() || null,
      capabilities: Array.from(
        new Set((definition.capabilities || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
      ).sort(),
      accountFields: (definition.accountFields || []).map((field) => ({
        key: String(field.key || '').trim(),
        label: String(field.label || '').trim(),
        type: String(field.type || 'text').trim().toLowerCase() || 'text',
        required: Boolean(field.required),
        secret: Boolean(field.secret) || String(field.type || 'text').trim().toLowerCase() === 'secret',
        placeholder: String(field.placeholder || '').trim() || null,
        helpText: String(field.helpText || '').trim() || null,
        options: Array.isArray(field.options)
          ? field.options
              .map((option) => ({
                value: String(option.value || '').trim(),
                label: String(option.label || '').trim(),
              }))
              .filter((option) => option.value && option.label)
          : [],
      })),
      integrationGuide: this.normalizeIntegrationGuide(definition.integrationGuide) as ComparableBrokerDefinition['integrationGuide'],
      diagnostics: this.normalizeDiagnostics(definition.diagnostics) as ComparableBrokerDefinition['diagnostics'],
    };
  }

  private toComparableDefinitionFromPayload(
    payload: ValidatedBrokerDefinitionUpsertBody,
    existingBaseUrl?: string | null
  ): ComparableBrokerDefinition {
    return {
      brokerKey: payload.brokerKey,
      name: payload.name,
      category: payload.category,
      status: payload.status,
      providerType: payload.providerType,
      linkedExchangeKey: payload.linkedExchangeKey ?? null,
      baseUrl: payload.baseUrl ?? (String(existingBaseUrl || '').trim() || null),
      capabilities: [...payload.capabilities].sort(),
      accountFields: payload.accountFields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        secret: field.secret,
        placeholder: field.placeholder ?? null,
        helpText: field.helpText ?? null,
        options: Array.isArray(field.options) ? field.options : [],
      })),
      integrationGuide: this.normalizeIntegrationGuide(payload.integrationGuide) as ComparableBrokerDefinition['integrationGuide'],
      diagnostics: this.normalizeDiagnostics(payload.diagnostics) as ComparableBrokerDefinition['diagnostics'],
    };
  }

  private normalizeIntegrationGuide(
    guide?: BrokerDefinitionItem['integrationGuide'] | ValidatedBrokerDefinitionUpsertBody['integrationGuide']
  ): ComparableBrokerDefinition['integrationGuide'] {
    if (!guide) {
      return null;
    }

    const summary = String(guide.summary || '').trim() || null;
    const docsUrl = String(guide.docsUrl || '').trim() || null;
    const notes = Array.isArray(guide.notes)
      ? guide.notes.map((note) => String(note || '').trim()).filter(Boolean)
      : [];
    const steps = Array.isArray(guide.steps)
      ? guide.steps
          .map((step) => ({
            title: String(step?.title || '').trim(),
            description: String(step?.description || '').trim(),
          }))
          .filter((step) => step.title && step.description)
      : [];

    if (!summary && !docsUrl && notes.length === 0 && steps.length === 0) {
      return null;
    }

    return {
      summary,
      docsUrl,
      notes,
      steps,
    };
  }

  private normalizeDiagnostics(
    diagnostics?: BrokerDefinitionItem['diagnostics'] | ValidatedBrokerDefinitionUpsertBody['diagnostics']
  ): ComparableBrokerDefinition['diagnostics'] {
    if (!diagnostics) {
      return null;
    }

    const normalized = {
      requiresAccount: Boolean(diagnostics.requiresAccount),
      executorKey: String(diagnostics.executorKey || '').trim() || null,
      successStatus: String(diagnostics.successStatus || 'Connected').trim() || 'Connected',
      failureStatus: String(diagnostics.failureStatus || 'Disconnected').trim() || 'Disconnected',
      resetStatus: String(diagnostics.resetStatus || 'Idle').trim() || 'Idle',
    };

    if (
      !normalized.requiresAccount &&
      !normalized.executorKey &&
      normalized.successStatus === 'Connected' &&
      normalized.failureStatus === 'Disconnected' &&
      normalized.resetStatus === 'Idle'
    ) {
      return null;
    }

    return normalized;
  }

}
