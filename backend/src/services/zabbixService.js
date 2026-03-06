import axios from 'axios';
import https from 'https';
import { logger } from '../utils/logger.js';

/**
 * Zabbix SNMP item key prefixes — Dell iDRAC SNMP template (dell.server.*)
 *
 * Cloud API already covers: CPU %, memory usage %, PSUs, temperature probes,
 * cooling device health, array disk health, network adapters, model, service tag.
 *
 * Zabbix uniquely adds:
 *   - OS name & version         (dell.server.sw.os)
 *   - BIOS version              (dell.server.bios.version)
 *   - iDRAC firmware version    (dell.server.hw.firmware)
 *   - Per-DIMM status & size    (dell.server.memory.status/size)
 *   - Fan RPM readings          (dell.server.sensor.fan.speed)
 *   - RAID controller model/status (dell.server.hw.diskarray)
 *   - Virtual disk status       (dell.server.hw.virtualdisk)
 *   - Physical disk details     (dell.server.hw.physicaldisk)
 *   - Hardware uptime           (dell.server.hw.uptime)
 *   - Overall system health     (dell.server.status)
 */
const ITEM_KEY_PATTERNS = [
  'dell.server.sw.os',
  'dell.server.bios',
  'dell.server.hw.firmware',
  'dell.server.memory.status',
  'dell.server.memory.size',
  'dell.server.sensor.fan',
  'dell.server.hw.diskarray',
  'dell.server.hw.virtualdisk',
  'dell.server.hw.physicaldisk',
  'dell.server.hw.uptime',
  'dell.server.status',
];

class ZabbixService {
  constructor() {
    this.apiUrl = process.env.ZABBIX_URL || 'https://gtpd-zabbix.police.gatech.edu/zabbix/api_jsonrpc.php';
    this.apiToken = process.env.ZABBIX_API_TOKEN;

    // Cache for item data — refresh every 5 minutes
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000;

    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    logger.info('ZabbixService initialized:');
    logger.info('- ZABBIX_URL:', this.apiUrl);
    logger.info('- ZABBIX_API_TOKEN:', this.apiToken ? 'Set' : 'MISSING');
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  getCached(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiry) return entry.data;
    if (entry) this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, expiry: Date.now() + this.cacheTTL });
  }

  // ---------------------------------------------------------------------------
  // Raw Zabbix API call
  // ---------------------------------------------------------------------------

  async call(method, params) {
    if (!this.apiToken) {
      throw new Error('ZABBIX_API_TOKEN must be set in .env');
    }

    const response = await this.axiosInstance.post(this.apiUrl, {
      jsonrpc: '2.0',
      method,
      params,
      auth: this.apiToken,
      id: 1,
    });

    if (response.data.error) {
      throw new Error(`Zabbix API error (${method}): ${response.data.error.data || response.data.error.message}`);
    }

    return response.data.result;
  }

  // ---------------------------------------------------------------------------
  // Host lookup
  // ---------------------------------------------------------------------------

  /**
   * Get all Zabbix hosts that have SNMP interfaces (i.e. monitored NVR servers).
   * Returns an array of { hostid, name, host, ip, snmpAvailable }.
   */
  async getHosts() {
    const cacheKey = 'hosts';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const hosts = await this.call('host.get', {
      output: ['hostid', 'host', 'name', 'available', 'status'],
      selectInterfaces: ['ip', 'type', 'available'],
      filter: { status: 0 }, // enabled hosts only
    });

    // Keep only hosts with an SNMP interface (type 2)
    const snmpHosts = hosts
      .filter(h => h.interfaces?.some(i => i.type === '2'))
      .map(h => {
        const snmpIface = h.interfaces.find(i => i.type === '2');
        return {
          hostid: h.hostid,
          name: h.name,
          host: h.host,
          ip: snmpIface?.ip || null,
          snmpAvailable: snmpIface?.available === '1',
        };
      });

    this.setCache(cacheKey, snmpHosts);
    return snmpHosts;
  }

  /**
   * Find a Zabbix host by its IP address or hostname.
   * Returns null if not found in Zabbix (server not added yet).
   */
  async findHostByIpOrName(ipOrName) {
    const hosts = await this.getHosts();

    // Try IP match first, then name (case-insensitive)
    return (
      hosts.find(h => h.ip === ipOrName) ||
      hosts.find(h => h.name?.toLowerCase() === ipOrName?.toLowerCase()) ||
      hosts.find(h => h.host?.toLowerCase() === ipOrName?.toLowerCase()) ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // Item fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetch latest SNMP item values for a hostid.
   * Returns only items whose keys/names match ITEM_KEY_PATTERNS.
   */
  async getItemsForHost(hostid) {
    const cacheKey = `items_${hostid}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const items = await this.call('item.get', {
      output: ['itemid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'value_type'],
      hostids: hostid,
      filter: { state: 0 }, // normal (not unsupported)
      sortfield: 'name',
    });

    // Filter to only the items we care about
    const filtered = items.filter(item =>
      ITEM_KEY_PATTERNS.some(pattern =>
        item.key_.toLowerCase().includes(pattern.toLowerCase()) ||
        item.name.toLowerCase().includes(pattern.toLowerCase())
      )
    );

    this.setCache(cacheKey, filtered);
    return filtered;
  }

  // ---------------------------------------------------------------------------
  // Data normalization
  // ---------------------------------------------------------------------------

  /**
   * Parse raw Zabbix items into a structured object with only the fields
   * that complement (don't duplicate) the Cloud API data.
   */
  normalizeItems(items) {
    // Find single item by exact key prefix
    const byKey = (prefix) =>
      items.find(i => i.key_.startsWith(prefix))?.lastvalue ?? null;

    // Find all items whose key starts with prefix, mapped to { name, value, units, key }
    const allByKey = (prefix) =>
      items
        .filter(i => i.key_.startsWith(prefix))
        .map(i => ({ name: i.name, value: i.lastvalue, units: i.units, key: i.key_ }));

    // OS
    const os = byKey('dell.server.sw.os');

    // BIOS
    const bios = byKey('dell.server.bios.version');

    // iDRAC firmware
    const idracFirmware = byKey('dell.server.hw.firmware');

    // Overall system health (globalSystemStatus — value 3 = OK, 5 = critical, etc.)
    const overallHealth = byKey('dell.server.status');

    // Hardware uptime (seconds)
    const uptime = byKey('dell.server.hw.uptime');

    // Per-DIMM status and size
    const dimmStatus = allByKey('dell.server.memory.status');
    const dimmSize   = allByKey('dell.server.memory.size');
    // Merge into per-slot objects keyed by DIMM name
    const dimms = dimmStatus.length
      ? dimmStatus.map(d => {
          const slot = d.key.replace('dell.server.memory.status[', '').replace(']', '');
          const sizeItem = dimmSize.find(s => s.key.includes(`[${slot}]`));
          return { slot, status: d.value, sizeBytes: sizeItem?.value ?? null };
        })
      : null;

    // Fan speeds (RPM)
    const fans = allByKey('dell.server.sensor.fan.speed').map(f => ({
      name: f.name.replace('Fan [', '').replace(']: Speed', ''),
      rpm: f.value,
    }));

    // RAID/disk array controllers (model + status combined)
    // Model key: dell.server.hw.diskarray.model[controllerName.1]   → numeric suffix "1"
    // Status key: dell.server.hw.diskarray.status[controllerComponentStatus.1] → same suffix "1"
    const controllerModels   = allByKey('dell.server.hw.diskarray.model');
    const controllerStatuses = allByKey('dell.server.hw.diskarray.status');
    const raidControllers = controllerModels.length
      ? controllerModels.map(m => {
          const slotNum = m.key.match(/\.(\d+)\]$/)?.[1];
          const statusItem = controllerStatuses.find(s => s.key.match(/\.(\d+)\]$/)?.[1] === slotNum);
          return { name: m.value, status: statusItem?.value ?? null };
        })
      : null;

    // Virtual disks (RAID volumes)
    const virtualDisks = allByKey('dell.server.hw.virtualdisk.status').map(v => ({
      name: v.name.match(/\[(.+?)\]:/)?.[1] || v.name,
      status: v.value,
    }));

    // Physical disks — group all attribute items by numeric disk index
    // Key format: dell.server.hw.physicaldisk.<field>[<oidName>.<number>]
    // All attributes of the same disk share the same trailing number.
    const pdFieldMap = {
      model:        'model',
      smart_status: 'smartStatus',
      serialnumber: 'serial',
      size:         'sizeBytes',
      status:       'status',
      media_type:   'mediaType',
    };
    const diskMap = {};
    for (const item of allByKey('dell.server.hw.physicaldisk')) {
      const keyBase = item.key.split('[')[0];              // e.g. 'dell.server.hw.physicaldisk.model'
      const field   = keyBase.split('.').pop();            // e.g. 'model'
      if (!pdFieldMap[field]) continue;                    // skip walk/unsupported items
      const diskIdx = item.key.match(/\.(\d+)\]$/)?.[1];  // numeric suffix — same for all fields of one disk
      if (!diskIdx) continue;
      if (!diskMap[diskIdx]) {
        const labelMatch = item.name.match(/\[(.+?)\]:/);
        diskMap[diskIdx] = { label: labelMatch?.[1] || diskIdx };
      }
      diskMap[diskIdx][pdFieldMap[field]] = item.value;
    }
    const physicalDisks = Object.values(diskMap).length ? Object.values(diskMap) : null;

    return {
      os:              os || null,
      bios:            bios || null,
      idracFirmware:   idracFirmware || null,
      overallHealth:   overallHealth || null,
      uptimeSeconds:   uptime ? parseInt(uptime, 10) : null,
      dimms:           dimms,
      fans:            fans.length ? fans : null,
      raidControllers: raidControllers,
      virtualDisks:    virtualDisks.length ? virtualDisks : null,
      physicalDisks:   physicalDisks,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Export one or more hosts as Zabbix XML using the configuration.export API.
   * Returns the raw XML string — guaranteed to be in whatever format this
   * Zabbix version expects, so we can use it as a template for new hosts.
   */
  async exportHostsXml(hostids) {
    return this.call('configuration.export', {
      options: { hosts: hostids },
      format: 'xml',
      prettyprint: false,
    });
  }

  /**
   * Get all Zabbix hosts with their groups, templates, and SNMP interface details.
   * Used to determine the reference config (template, host group, SNMP settings)
   * when generating an import file for servers not yet added to Zabbix.
   */
  async getHostsFullDetails() {
    const cacheKey = 'hosts_full';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const hosts = await this.call('host.get', {
      output: ['hostid', 'host', 'name', 'status'],
      selectGroups: ['name'],
      selectTemplates: ['name'],
      selectInterfaces: ['ip', 'dns', 'port', 'type', 'useip', 'details'],
      filter: { status: 0 },
    });

    this.setCache(cacheKey, hosts);
    return hosts;
  }

  /**
   * Get Zabbix-sourced hardware details for a server identified by IP or hostname.
   * Returns { available: false, reason: 'not_in_zabbix' } if not monitored yet.
   */
  async getServerHealth(ipOrName) {
    try {
      const host = await this.findHostByIpOrName(ipOrName);
      if (!host) {
        return { available: false, reason: 'not_in_zabbix' };
      }

      if (!host.snmpAvailable) {
        return {
          available: true,
          snmpAvailable: false,
          hostid: host.hostid,
          name: host.name,
          ip: host.ip,
          reason: 'snmp_unavailable',
          data: null,
        };
      }

      const items = await this.getItemsForHost(host.hostid);
      const data = this.normalizeItems(items);

      return {
        available: true,
        snmpAvailable: true,
        hostid: host.hostid,
        name: host.name,
        ip: host.ip,
        data,
      };
    } catch (error) {
      logger.error(`Zabbix getServerHealth(${ipOrName}) failed:`, error.message);
      return { available: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Get Zabbix health data for all monitored SNMP hosts.
   */
  async getAllServerHealth() {
    const cacheKey = 'all_server_health';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const hosts = await this.getHosts();

    const results = await Promise.allSettled(
      hosts.map(async (host) => {
        if (!host.snmpAvailable) {
          return {
            available: true,
            snmpAvailable: false,
            hostid: host.hostid,
            name: host.name,
            ip: host.ip,
            reason: 'snmp_unavailable',
            data: null,
          };
        }
        const items = await this.getItemsForHost(host.hostid);
        const data = this.normalizeItems(items);
        return {
          available: true,
          snmpAvailable: true,
          hostid: host.hostid,
          name: host.name,
          ip: host.ip,
          data,
        };
      })
    );

    const summary = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { available: false, reason: 'error', name: hosts[i].name, ip: hosts[i].ip, error: r.reason?.message }
    );

    this.setCache(cacheKey, summary);
    return summary;
  }

  /**
   * Check connectivity without throwing.
   */
  async testConnection() {
    try {
      const hosts = await this.getHosts();
      return { ok: true, hostCount: hosts.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

export default ZabbixService;
