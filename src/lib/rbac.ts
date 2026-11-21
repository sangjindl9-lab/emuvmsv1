export const PERMISSIONS = {
  SYSTEM_ADMIN: "system.admin",
  USER_MANAGE: "user.manage",
  SITE_MANAGE: "site.manage",
  DEVICE_MANAGE: "device.manage",
  PROTOCOL_MANAGE: "protocol.manage",
  TAG_MANAGE: "tag.manage",
  SCADA_VIEW: "scada.view",
  SCADA_EDIT: "scada.edit",
  CONTROL_REQUEST: "control.request",
  CONTROL_APPROVE: "control.approve",
  METERING_MANAGE: "metering.manage",
  TARIFF_MANAGE: "tariff.manage",
  ALARM_MANAGE: "alarm.manage",
  REPORT_VIEW: "report.view",
  LICENSE_MANAGE: "license.manage",
  AUDIT_VIEW: "audit.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export type RoleCode = "SUPER_ADMIN" | "ADMIN" | "OPERATOR" | "APPROVER" | "VIEWER";

export const ROLE_DEFINITIONS: Record<RoleCode, { name: string; permissions: string[] }> = {
  SUPER_ADMIN: { name: "최고관리자", permissions: ALL_PERMISSIONS },
  ADMIN: {
    name: "관리자",
    permissions: [
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.SITE_MANAGE,
      PERMISSIONS.DEVICE_MANAGE,
      PERMISSIONS.PROTOCOL_MANAGE,
      PERMISSIONS.TAG_MANAGE,
      PERMISSIONS.SCADA_VIEW,
      PERMISSIONS.SCADA_EDIT,
      PERMISSIONS.CONTROL_REQUEST,
      PERMISSIONS.METERING_MANAGE,
      PERMISSIONS.TARIFF_MANAGE,
      PERMISSIONS.ALARM_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.AUDIT_VIEW,
    ],
  },
  OPERATOR: {
    name: "운전원",
    permissions: [
      PERMISSIONS.SCADA_VIEW,
      PERMISSIONS.SCADA_EDIT,
      PERMISSIONS.CONTROL_REQUEST,
      PERMISSIONS.TAG_MANAGE,
      PERMISSIONS.METERING_MANAGE,
      PERMISSIONS.ALARM_MANAGE,
      PERMISSIONS.REPORT_VIEW,
    ],
  },
  APPROVER: {
    name: "승인자",
    permissions: [
      PERMISSIONS.SCADA_VIEW,
      PERMISSIONS.CONTROL_APPROVE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.ALARM_MANAGE,
    ],
  },
  VIEWER: {
    name: "조회자",
    permissions: [PERMISSIONS.SCADA_VIEW, PERMISSIONS.REPORT_VIEW],
  },
};

export function hasPermission(permissions: string[] | undefined, needed: string): boolean {
  if (!permissions) return false;
  return permissions.includes(PERMISSIONS.SYSTEM_ADMIN) || permissions.includes(needed);
}
