import zabbixService from '../services/zabbixServiceInstance.js';
import { logger } from '../utils/logger.js';

const DNS_SUFFIX = '.police.gatech.edu';

// ---------------------------------------------------------------------------
// Zabbix XML import file builder
// ---------------------------------------------------------------------------

/**
 * Extract the <interface>…</interface> block for the first SNMP interface
 * from a Zabbix configuration.export XML string.
 * Returns null if not found.
 */
function extractSnmpInterfaceXml(exportedXml) {
  // Find every <interface>…</interface> block
  const ifaceRegex = /<interface>([\s\S]*?)<\/interface>/g;
  let match;
  while ((match = ifaceRegex.exec(exportedXml)) !== null) {
    if (match[1].includes('<type>SNMP</type>')) {
      return match[0]; // return the full <interface>…</interface> block
    }
  }
  return null;
}

/**
 * Given a reference SNMP <interface> block (lifted verbatim from a Zabbix
 * configuration.export), replace the IP address with the target server's IP
 * and replace the <default> tag to ensure it is set to YES.
 */
function buildInterfaceXml(refInterfaceXml, ip, port) {
  return refInterfaceXml
    .replace(/<ip>[^<]*<\/ip>/, `<ip>${ip}</ip>`)
    .replace(/<port>[^<]*<\/port>/, `<port>${port}</port>`)
    .replace(/<default>[^<]*<\/default>/, '<default>YES</default>');
}

function buildImportXml(servers, groups, templates, refInterfaceXml, refPort) {
  const hostsXml = servers.map(s => `
    <host>
      <host>${s.name}</host>
      <name>${s.fqdn}</name>
      <groups>
        ${groups.map(g => `<group><name>${g}</name></group>`).join('\n        ')}
      </groups>
      <templates>
        ${templates.map(t => `<template><name>${t}</name></template>`).join('\n        ')}
      </templates>
      <interfaces>
        ${buildInterfaceXml(refInterfaceXml, s.ip, refPort)}
      </interfaces>
    </host>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<zabbix_export>
  <version>7.0</version>
  <hosts>${hostsXml}
  </hosts>
</zabbix_export>
`;
}

/**
 * GET /api/zabbix/status
 * Quick connectivity check — useful to show "Zabbix connected" indicator in the UI.
 */
export const getZabbixStatus = async (req, res) => {
  try {
    const result = await zabbixService.testConnection();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Zabbix status check failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/zabbix/servers
 * Returns Zabbix hardware health data for all monitored SNMP hosts.
 * Servers not yet added to Zabbix simply won't appear here — the frontend
 * should treat missing entries as "not monitored yet".
 */
export const getZabbixServers = async (req, res) => {
  try {
    const servers = await zabbixService.getAllServerHealth();
    res.json({ success: true, data: servers });
  } catch (error) {
    logger.error('getZabbixServers failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/zabbix/servers/:ipOrName
 * Returns Zabbix hardware health for a single server, looked up by IP or hostname.
 * Returns { available: false, reason: 'not_in_zabbix' } if not monitored yet.
 */
export const getZabbixServerHealth = async (req, res) => {
  try {
    const { ipOrName } = req.params;
    const result = await zabbixService.getServerHealth(decodeURIComponent(ipOrName));
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error(`getZabbixServerHealth(${req.params.ipOrName}) failed:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/zabbix/missing-import
 * Body: { servers: [{ name: "GTPDACCSERVER10", ip: "10.x.x.x" }, ...] }
 *
 * The frontend sends its already-loaded server list (from dashboard stats) so
 * this handler never needs to contact the Avigilon ACC server directly.
 * Compares IPs against Zabbix hosts and returns a Zabbix-importable XML file
 * for every server not yet monitored. Inherits the host group, template(s),
 * and SNMP interface config from the first existing SNMP host in Zabbix.
 */
export const generateZabbixImport = async (req, res) => {
  try {
    // 1. Server list comes from the frontend (dashboard stats already resolved IPs)
    const incoming = req.body?.servers || [];
    const serversWithIPs = incoming
      .filter((s) => s.name && s.ip)
      .map((s) => ({
        name: s.name,
        fqdn: `${s.name}${DNS_SUFFIX}`,
        ip: s.ip,
      }));

    if (serversWithIPs.length === 0) {
      return res.status(400).json({ success: false, error: 'No servers with resolved IPs provided.' });
    }

    // 2. Get Zabbix hosts with full details (groups, templates, interfaces)
    const zabbixHosts = await zabbixService.getHostsFullDetails();

    // Build lookup sets for servers already in Zabbix
    const zabbixIPs = new Set();
    const zabbixNamesLower = new Set();
    for (const h of zabbixHosts) {
      for (const iface of h.interfaces || []) {
        if (iface.ip) zabbixIPs.add(iface.ip);
      }
      if (h.name) zabbixNamesLower.add(h.name.toLowerCase());
      if (h.host) zabbixNamesLower.add(h.host.toLowerCase());
    }

    // 3. Find servers not yet in Zabbix
    const missingServers = serversWithIPs.filter(
      (s) =>
        !zabbixIPs.has(s.ip) &&
        !zabbixNamesLower.has(s.name.toLowerCase()) &&
        !zabbixNamesLower.has(s.fqdn.toLowerCase())
    );

    logger.info(
      `Zabbix import: ${missingServers.length} missing out of ${serversWithIPs.length} provided`
    );

    // 4. Derive config from the first existing SNMP host in Zabbix
    const refHost = zabbixHosts.find((h) =>
      h.interfaces?.some((i) => i.type === '2')
    );
    if (!refHost) {
      return res.status(500).json({ success: false, error: 'No existing SNMP hosts found in Zabbix to use as a template.' });
    }
    const groups    = refHost.groups?.map((g) => g.name) || ['NVR Servers'];
    const templates = refHost.templates?.map((t) => t.name) || [];
    const refSnmpIface = refHost.interfaces.find((i) => i.type === '2');
    const refPort   = refSnmpIface?.port || '161';

    // Export the reference host as XML so we get the exact <details> format
    // that this Zabbix version expects — no guessing at version strings.
    const exportedXml     = await zabbixService.exportHostsXml([refHost.hostid]);
    const refInterfaceXml = extractSnmpInterfaceXml(exportedXml);
    if (!refInterfaceXml) {
      return res.status(500).json({ success: false, error: 'Could not extract SNMP interface from reference host export.' });
    }

    // 5. Build and return the XML file
    const xml = buildImportXml(missingServers, groups, templates, refInterfaceXml, refPort);

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zabbix-missing-hosts.xml"');
    res.setHeader('X-Missing-Count', String(missingServers.length));
    res.send(xml);
  } catch (error) {
    logger.error('generateZabbixImport failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
