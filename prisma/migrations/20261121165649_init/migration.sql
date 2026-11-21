-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessNo" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "roleId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "contractPowerKw" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "floorsCount" INTEGER NOT NULL DEFAULT 0,
    "areaM2" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT,
    "dong" TEXT,
    "ho" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaM2" DOUBLE PRECISION,
    "occupancy" TEXT NOT NULL DEFAULT 'OCCUPIED',
    "residentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKo" TEXT,
    "country" TEXT,
    "website" TEXT,
    "note" TEXT,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_models" (
    "id" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "protocols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "docsUrl" TEXT,
    "notes" TEXT,

    CONSTRAINT "device_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manufacturerId" TEXT,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" TEXT,
    "url" TEXT,
    "license" TEXT,
    "accessType" TEXT NOT NULL DEFAULT 'PUBLIC',
    "fileName" TEXT,
    "fileHash" TEXT,
    "extractedText" TEXT,
    "analysis" JSONB,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_drivers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manufacturerId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocolFamily" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DOC_VERIFIED',
    "description" TEXT,
    "docsUrl" TEXT,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT,
    "config" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manufacturerId" TEXT,
    "modelId" TEXT,
    "driverId" TEXT,
    "driverVersionId" TEXT,
    "name" TEXT NOT NULL,
    "protocolKey" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "settings" JSONB,
    "registerMap" JSONB,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "documentId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "confidence" DOUBLE PRECISION,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateways" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EDGE',
    "mode" TEXT NOT NULL DEFAULT 'TCP_CLIENT',
    "convertsProtocol" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT,
    "port" INTEGER,
    "tokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3),
    "bufferDepth" INTEGER NOT NULL DEFAULT 0,
    "firmware" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "floorId" TEXT,
    "unitId" TEXT,
    "gatewayId" TEXT,
    "serialBusId" TEXT,
    "profileId" TEXT,
    "manufacturerId" TEXT,
    "modelId" TEXT,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "serialNumber" TEXT,
    "firmware" TEXT,
    "protocolKey" TEXT NOT NULL,
    "host" TEXT,
    "port" INTEGER,
    "slaveId" INTEGER,
    "stationNo" INTEGER,
    "rack" INTEGER,
    "slot" INTEGER,
    "pollingMs" INTEGER NOT NULL DEFAULT 1000,
    "timeoutMs" INTEGER NOT NULL DEFAULT 1000,
    "retryCount" INTEGER NOT NULL DEFAULT 2,
    "credentialEnc" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "host" TEXT,
    "port" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CONNECTING',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_buses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "port" TEXT,
    "baudRate" INTEGER NOT NULL DEFAULT 9600,
    "parity" TEXT NOT NULL DEFAULT 'N',
    "dataBits" INTEGER NOT NULL DEFAULT 8,
    "stopBits" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'RTU',
    "pollGapMs" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serial_buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" INTEGER NOT NULL,
    "functionCode" INTEGER NOT NULL DEFAULT 3,
    "dataType" TEXT NOT NULL DEFAULT 'FLOAT32',
    "unit" TEXT,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "offset" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "byteOrder" TEXT NOT NULL DEFAULT 'AB',
    "wordOrder" TEXT NOT NULL DEFAULT 'ABCD',
    "pollingMs" INTEGER NOT NULL DEFAULT 1000,
    "writable" BOOLEAN NOT NULL DEFAULT false,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "alarmHigh" DOUBLE PRECISION,
    "alarmLow" DOUBLE PRECISION,
    "deadband" DOUBLE PRECISION,
    "standardKey" TEXT,
    "quality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastValue" DOUBLE PRECISION,
    "lastValueText" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL DEFAULT 'value',
    "transform" TEXT,

    CONSTRAINT "tag_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DOUBLE PRECISION,
    "quality" TEXT NOT NULL DEFAULT 'GOOD',
    "raw" JSONB,

    CONSTRAINT "tag_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT,
    "deviceId" TEXT,
    "meterKind" TEXT NOT NULL DEFAULT 'ELECTRICITY',
    "readingAt" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "periodKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_adjustments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meterReadingId" TEXT,
    "deviceId" TEXT,
    "unitId" TEXT,
    "kind" TEXT NOT NULL,
    "deltaValue" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tariff_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "electrical_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "ratedCapacity" TEXT,
    "voltage" TEXT,
    "phases" INTEGER,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "breakerState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "remoteControlEnabled" BOOLEAN NOT NULL DEFAULT false,
    "interlocks" JSONB,
    "tagIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "electrical_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagrams" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "backgroundUrl" TEXT,
    "canvas" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagrams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagram_elements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "diagramId" TEXT NOT NULL,
    "elementKey" TEXT NOT NULL,
    "symbolType" TEXT NOT NULL,
    "label" TEXT,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assetId" TEXT,
    "tagId" TEXT,
    "props" JSONB,
    "zIndex" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diagram_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'TAG',
    "targetId" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'GT',
    "threshold" DOUBLE PRECISION,
    "threshold2" DOUBLE PRECISION,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[] DEFAULT ARRAY['INAPP']::TEXT[],
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "ruleId" TEXT,
    "deviceId" TEXT,
    "assetId" TEXT,
    "tagId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "repeatCount" INTEGER NOT NULL DEFAULT 1,
    "value" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_commands" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "deviceId" TEXT,
    "command" TEXT NOT NULL,
    "payload" JSONB,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 2,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "localRemoteState" TEXT,
    "interlockCheck" JSONB,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "finalState" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_approvals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "approverId" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'APPROVED',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL,
    "measured" JSONB,
    "detail" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "control_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT 'STANDARD',
    "maxSites" INTEGER NOT NULL DEFAULT 1,
    "maxDevices" INTEGER NOT NULL DEFAULT 100,
    "maxTags" INTEGER NOT NULL DEFAULT 10000,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hardwareId" TEXT,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_code_key" ON "roles"("tenantId", "code");

-- CreateIndex
CREATE INDEX "sites_tenantId_idx" ON "sites"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenantId_code_key" ON "sites"("tenantId", "code");

-- CreateIndex
CREATE INDEX "buildings_tenantId_idx" ON "buildings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_siteId_code_key" ON "buildings"("siteId", "code");

-- CreateIndex
CREATE INDEX "floors_tenantId_idx" ON "floors"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "floors_buildingId_level_key" ON "floors"("buildingId", "level");

-- CreateIndex
CREATE INDEX "units_tenantId_idx" ON "units"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "units_buildingId_dong_ho_key" ON "units"("buildingId", "dong", "ho");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_name_key" ON "manufacturers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "device_models_manufacturerId_name_key" ON "device_models"("manufacturerId", "name");

-- CreateIndex
CREATE INDEX "protocol_documents_tenantId_idx" ON "protocol_documents"("tenantId");

-- CreateIndex
CREATE INDEX "protocol_drivers_tenantId_idx" ON "protocol_drivers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_drivers_tenantId_key_key" ON "protocol_drivers"("tenantId", "key");

-- CreateIndex
CREATE INDEX "driver_versions_tenantId_idx" ON "driver_versions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_versions_driverId_version_key" ON "driver_versions"("driverId", "version");

-- CreateIndex
CREATE INDEX "device_profiles_tenantId_idx" ON "device_profiles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "gateways_serial_key" ON "gateways"("serial");

-- CreateIndex
CREATE INDEX "gateways_tenantId_idx" ON "gateways"("tenantId");

-- CreateIndex
CREATE INDEX "devices_tenantId_siteId_idx" ON "devices"("tenantId", "siteId");

-- CreateIndex
CREATE INDEX "device_connections_tenantId_deviceId_idx" ON "device_connections"("tenantId", "deviceId");

-- CreateIndex
CREATE INDEX "serial_buses_tenantId_idx" ON "serial_buses"("tenantId");

-- CreateIndex
CREATE INDEX "device_tags_tenantId_siteId_idx" ON "device_tags"("tenantId", "siteId");

-- CreateIndex
CREATE INDEX "device_tags_tenantId_standardKey_idx" ON "device_tags"("tenantId", "standardKey");

-- CreateIndex
CREATE UNIQUE INDEX "device_tags_deviceId_key_key" ON "device_tags"("deviceId", "key");

-- CreateIndex
CREATE INDEX "tag_mappings_tenantId_target_targetId_idx" ON "tag_mappings"("tenantId", "target", "targetId");

-- CreateIndex
CREATE INDEX "tag_readings_tagId_ts_idx" ON "tag_readings"("tagId", "ts");

-- CreateIndex
CREATE INDEX "tag_readings_tenantId_ts_idx" ON "tag_readings"("tenantId", "ts");

-- CreateIndex
CREATE INDEX "meter_readings_tenantId_siteId_readingAt_idx" ON "meter_readings"("tenantId", "siteId", "readingAt");

-- CreateIndex
CREATE INDEX "meter_readings_tenantId_periodKey_idx" ON "meter_readings"("tenantId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_tenantId_deviceId_readingAt_key" ON "meter_readings"("tenantId", "deviceId", "readingAt");

-- CreateIndex
CREATE INDEX "meter_adjustments_tenantId_deviceId_idx" ON "meter_adjustments"("tenantId", "deviceId");

-- CreateIndex
CREATE INDEX "tariff_versions_tenantId_status_idx" ON "tariff_versions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_versions_tenantId_name_version_key" ON "tariff_versions"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "electrical_assets_tenantId_siteId_idx" ON "electrical_assets"("tenantId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "electrical_assets_siteId_code_key" ON "electrical_assets"("siteId", "code");

-- CreateIndex
CREATE INDEX "diagrams_tenantId_siteId_idx" ON "diagrams"("tenantId", "siteId");

-- CreateIndex
CREATE INDEX "diagram_elements_tenantId_idx" ON "diagram_elements"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "diagram_elements_diagramId_elementKey_key" ON "diagram_elements"("diagramId", "elementKey");

-- CreateIndex
CREATE INDEX "alarm_rules_tenantId_enabled_idx" ON "alarm_rules"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "alarm_events_tenantId_occurredAt_idx" ON "alarm_events"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "alarm_events_tenantId_status_idx" ON "alarm_events"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "control_commands_idempotencyKey_key" ON "control_commands"("idempotencyKey");

-- CreateIndex
CREATE INDEX "control_commands_tenantId_status_idx" ON "control_commands"("tenantId", "status");

-- CreateIndex
CREATE INDEX "control_approvals_tenantId_idx" ON "control_approvals"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "control_approvals_commandId_approverId_key" ON "control_approvals"("commandId", "approverId");

-- CreateIndex
CREATE INDEX "control_feedback_tenantId_commandId_idx" ON "control_feedback"("tenantId", "commandId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_licenseKey_key" ON "licenses"("licenseKey");

-- CreateIndex
CREATE INDEX "licenses_tenantId_idx" ON "licenses"("tenantId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "floors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_documents" ADD CONSTRAINT "protocol_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_documents" ADD CONSTRAINT "protocol_documents_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_documents" ADD CONSTRAINT "protocol_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_drivers" ADD CONSTRAINT "protocol_drivers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_drivers" ADD CONSTRAINT "protocol_drivers_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_versions" ADD CONSTRAINT "driver_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_versions" ADD CONSTRAINT "driver_versions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "protocol_drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_versions" ADD CONSTRAINT "driver_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "device_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "protocol_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_driverVersionId_fkey" FOREIGN KEY ("driverVersionId") REFERENCES "driver_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "protocol_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "floors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_serialBusId_fkey" FOREIGN KEY ("serialBusId") REFERENCES "serial_buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "device_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "device_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_connections" ADD CONSTRAINT "device_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_connections" ADD CONSTRAINT "device_connections_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_buses" ADD CONSTRAINT "serial_buses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_buses" ADD CONSTRAINT "serial_buses_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tags" ADD CONSTRAINT "device_tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tags" ADD CONSTRAINT "device_tags_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_mappings" ADD CONSTRAINT "tag_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_mappings" ADD CONSTRAINT "tag_mappings_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "device_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_readings" ADD CONSTRAINT "tag_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_readings" ADD CONSTRAINT "tag_readings_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "device_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_adjustments" ADD CONSTRAINT "meter_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_adjustments" ADD CONSTRAINT "meter_adjustments_meterReadingId_fkey" FOREIGN KEY ("meterReadingId") REFERENCES "meter_readings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_adjustments" ADD CONSTRAINT "meter_adjustments_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_adjustments" ADD CONSTRAINT "meter_adjustments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_versions" ADD CONSTRAINT "tariff_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electrical_assets" ADD CONSTRAINT "electrical_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electrical_assets" ADD CONSTRAINT "electrical_assets_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electrical_assets" ADD CONSTRAINT "electrical_assets_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electrical_assets" ADD CONSTRAINT "electrical_assets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "electrical_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_elements" ADD CONSTRAINT "diagram_elements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_elements" ADD CONSTRAINT "diagram_elements_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "diagrams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_elements" ADD CONSTRAINT "diagram_elements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "electrical_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_elements" ADD CONSTRAINT "diagram_elements_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "device_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_rules" ADD CONSTRAINT "alarm_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_rules" ADD CONSTRAINT "alarm_rules_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alarm_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "electrical_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "device_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_commands" ADD CONSTRAINT "control_commands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_commands" ADD CONSTRAINT "control_commands_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "electrical_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_commands" ADD CONSTRAINT "control_commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_commands" ADD CONSTRAINT "control_commands_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_approvals" ADD CONSTRAINT "control_approvals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_approvals" ADD CONSTRAINT "control_approvals_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "control_commands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_approvals" ADD CONSTRAINT "control_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_feedback" ADD CONSTRAINT "control_feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_feedback" ADD CONSTRAINT "control_feedback_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "control_commands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
