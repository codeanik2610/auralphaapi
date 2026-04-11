import type {
  AutomationLineage,
  AutomationTemplateDiffSummary,
} from '../contracts/Automation';

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const readInteger = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
  }
  return null;
};

const parseTemplateDiffSummary = (
  ...values: unknown[]
): AutomationTemplateDiffSummary | null => {
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const summary = value as Record<string, unknown>;
    const changedCount = Number(summary.changedCount);
    const inheritedCount = Number(summary.inheritedCount);
    const changedFields = Array.isArray(summary.changedFields)
      ? summary.changedFields
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];

    if (
      !Number.isFinite(changedCount) &&
      !Number.isFinite(inheritedCount) &&
      !changedFields.length
    ) {
      continue;
    }

    return {
      changedCount: Number.isFinite(changedCount)
        ? Math.max(0, Math.trunc(changedCount))
        : changedFields.length,
      inheritedCount: Number.isFinite(inheritedCount)
        ? Math.max(0, Math.trunc(inheritedCount))
        : 0,
      changedFields,
    };
  }
  return null;
};

export const extractAutomationLineage = (value: unknown): AutomationLineage | null => {
  const root = parseRecord(value) ?? {};
  const nested = parseRecord(root.config) ?? {};
  const rootSnapshot = parseRecord(root.inputSnapshot) ?? {};
  const nestedSnapshot = parseRecord(nested.inputSnapshot) ?? {};
  const template =
    parseRecord(nestedSnapshot.template) ??
    parseRecord(rootSnapshot.template) ??
    parseRecord(nested.template) ??
    parseRecord(root.template) ??
    {};

  const inferredSourceType =
    readString(
      root.sourceType,
      nested.sourceType,
      rootSnapshot.sourceType,
      nestedSnapshot.sourceType
    ) ??
    (readString(
      root.projectId,
      nested.projectId,
      rootSnapshot.projectId,
      nestedSnapshot.projectId,
      root.sourceTemplateId,
      nested.sourceTemplateId,
      rootSnapshot.sourceTemplateId,
      nestedSnapshot.sourceTemplateId
    )
      ? 'strategy_lab'
      : readString(
            root.libraryId,
            nested.libraryId,
            rootSnapshot.libraryId,
            nestedSnapshot.libraryId,
            root.templateId,
            nested.templateId,
            rootSnapshot.templateId,
            nestedSnapshot.templateId,
            template.id
          )
        ? 'strategy_library'
        : null);

  const lineage: AutomationLineage = {
    source: readString(root.source, nested.source),
    backtestId: readString(root.backtestId, nested.backtestId),
    sourceType: inferredSourceType,
    sourceId:
      readString(root.sourceId, nested.sourceId, rootSnapshot.sourceId, nestedSnapshot.sourceId) ??
      (inferredSourceType === 'strategy_lab'
        ? readString(root.projectId, nested.projectId, rootSnapshot.projectId, nestedSnapshot.projectId)
        : inferredSourceType === 'strategy_library'
          ? readString(
              root.libraryId,
              nested.libraryId,
              rootSnapshot.libraryId,
              nestedSnapshot.libraryId,
              root.templateId,
              nested.templateId,
              rootSnapshot.templateId,
              nestedSnapshot.templateId,
              template.id
            )
          : null),
    libraryId: readString(root.libraryId, nested.libraryId, rootSnapshot.libraryId, nestedSnapshot.libraryId),
    libraryName: readString(
      root.libraryName,
      nested.libraryName,
      rootSnapshot.libraryName,
      nestedSnapshot.libraryName
    ),
    projectId: readString(root.projectId, nested.projectId, rootSnapshot.projectId, nestedSnapshot.projectId),
    projectVersion: readInteger(
      root.projectVersion,
      nested.projectVersion,
      rootSnapshot.projectVersion,
      nestedSnapshot.projectVersion
    ),
    templateId: readString(
      root.templateId,
      nested.templateId,
      rootSnapshot.templateId,
      nestedSnapshot.templateId,
      template.id
    ),
    templateName: readString(
      root.templateName,
      nested.templateName,
      rootSnapshot.templateName,
      nestedSnapshot.templateName,
      template.name
    ),
    templateVersion: readInteger(
      root.templateVersion,
      nested.templateVersion,
      rootSnapshot.templateVersion,
      nestedSnapshot.templateVersion,
      template.templateVersion
    ),
    sourceTemplateId: readString(
      root.sourceTemplateId,
      nested.sourceTemplateId,
      rootSnapshot.sourceTemplateId,
      nestedSnapshot.sourceTemplateId,
      template.sourceTemplateId
    ),
    sourceTemplateName: readString(
      root.sourceTemplateName,
      nested.sourceTemplateName,
      rootSnapshot.sourceTemplateName,
      nestedSnapshot.sourceTemplateName,
      template.sourceTemplateName
    ),
    sourceTemplateVersion: readInteger(
      root.sourceTemplateVersion,
      nested.sourceTemplateVersion,
      rootSnapshot.sourceTemplateVersion,
      nestedSnapshot.sourceTemplateVersion,
      template.sourceTemplateVersion
    ),
    templateDiffSummary: parseTemplateDiffSummary(
      root.templateDiffSummary,
      nested.templateDiffSummary,
      rootSnapshot.templateDiffSummary,
      nestedSnapshot.templateDiffSummary
    ),
  };

  return Object.values(lineage).some((item) => item !== null && item !== undefined && item !== '')
    ? lineage
    : null;
};
