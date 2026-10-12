export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & { friendly_name?: string };
  last_changed: string;
  last_updated: string;
}

export interface EntityRegistryEntry {
  entity_id: string;
  name: string | null;
  original_name: string | null;
  area_id: string | null;
  device_id: string | null;
  platform: string;
  hidden_by: string | null;
  disabled_by: string | null;
  entity_category: string | null;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  area_id: string | null;
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
}
