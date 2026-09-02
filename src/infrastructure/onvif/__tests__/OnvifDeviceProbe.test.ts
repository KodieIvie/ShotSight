import { describe, expect, it, vi } from 'vitest';

import {
  OnvifDeviceProbe,
  buildOnvifDeviceServiceEndpoint,
  classifyOnvifSoapFault,
  parseOnvifSoapFault,
  type OnvifTransport,
  type OnvifTransportRequest,
} from '../OnvifDeviceProbe';

const DEVICE_INFORMATION_RESPONSE = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetDeviceInformationResponse>
      <tds:Manufacturer>Acme Target Optics</tds:Manufacturer>
      <tds:Model>RangeCam 1</tds:Model>
      <tds:FirmwareVersion>v2.4.1</tds:FirmwareVersion>
      <tds:SerialNumber>SN-100</tds:SerialNumber>
      <tds:HardwareId>rev-b</tds:HardwareId>
    </tds:GetDeviceInformationResponse>
  </s:Body>
</s:Envelope>`;

const CAPABILITIES_RESPONSE = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <tds:GetCapabilitiesResponse>
      <tds:Capabilities>
        <tt:Device><tt:XAddr>http://192.168.50.8:8000/onvif/device_service</tt:XAddr></tt:Device>
        <tt:Media><tt:XAddr>http://192.168.50.8:8000/onvif/media_service</tt:XAddr></tt:Media>
        <tt:Events><tt:XAddr>http://192.168.50.8:8000/onvif/events_service</tt:XAddr></tt:Events>
        <tt:Analytics><tt:XAddr>https://cloud.example.invalid/onvif/analytics</tt:XAddr></tt:Analytics>
      </tds:Capabilities>
    </tds:GetCapabilitiesResponse>
  </s:Body>
</s:Envelope>`;

const NOT_AUTHORIZED_FAULT = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body><s:Fault>
    <s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code>
    <s:Reason><s:Text xml:lang="en">Authentication failed</s:Text></s:Reason>
  </s:Fault></s:Body>
</s:Envelope>`;

function scriptedTransport(): {
  readonly transport: OnvifTransport;
  readonly requests: OnvifTransportRequest[];
} {
  const requests: OnvifTransportRequest[] = [];
  return {
    requests,
    transport: {
      request: vi.fn(async (request: OnvifTransportRequest) => {
        requests.push(request);
        return request.body.includes('GetDeviceInformation')
          ? { status: 200, body: DEVICE_INFORMATION_RESPONSE }
          : { status: 200, body: CAPABILITIES_RESPONSE };
      }),
    },
  };
}

describe('ONVIF Device-service endpoint construction', () => {
  it('builds a local standard Device-service URL with secure defaults', () => {
    const defaults = buildOnvifDeviceServiceEndpoint({ host: '192.168.50.8' });
    expect(defaults.url).toBe('http://192.168.50.8/onvif/device_service');
    expect(defaults.port).toBe(80);

    const endpoint = buildOnvifDeviceServiceEndpoint({
      host: '192.168.50.8',
      port: 8000,
    });

    expect(endpoint.url).toBe('http://192.168.50.8:8000/onvif/device_service');
    expect(endpoint.redactedUrl).toBe(endpoint.url);
    expect(endpoint.port).toBe(8000);

    const httpsDefault = buildOnvifDeviceServiceEndpoint({
      host: 'camera.local',
      protocol: 'https',
    });
    expect(httpsDefault.url).toBe('https://camera.local/onvif/device_service');
    expect(httpsDefault.port).toBe(443);
  });

  it('rejects cloud/public, credential-bearing, and path-bearing host input', () => {
    expect(() => buildOnvifDeviceServiceEndpoint({ host: '8.8.8.8' })).toThrow(/local LAN/i);
    expect(() =>
      buildOnvifDeviceServiceEndpoint({ host: 'http://operator:secret@192.168.50.8' }),
    ).toThrow(/credentials/i);
    expect(() =>
      buildOnvifDeviceServiceEndpoint({ host: '192.168.50.8/onvif/device_service' }),
    ).toThrow(/path/i);
  });
});

describe('OnvifDeviceProbe', () => {
  it('uses standard SOAP actions, Basic auth headers, and returns only local capability URLs', async () => {
    const { transport, requests } = scriptedTransport();
    const report = await new OnvifDeviceProbe(transport).probe({
      endpoint: { host: '192.168.50.8', port: 8000 },
      credentials: { username: 'alice', password: 'secret-value' },
    });

    expect(report.status).toBe('available');
    expect(report.deviceInformation).toMatchObject({
      manufacturer: 'Acme Target Optics',
      model: 'RangeCam 1',
      serialNumber: 'SN-100',
    });
    expect(report.capabilities).toMatchObject({
      device: true,
      media: true,
      events: true,
      analytics: false,
      mediaServiceUrl: 'http://192.168.50.8:8000/onvif/media_service',
    });
    expect(report.capabilities?.analyticsServiceUrl).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('http://192.168.50.8:8000/onvif/device_service');
    expect(requests[0].url).not.toContain('alice');
    expect(requests[0].headers.Authorization).toBe('Basic YWxpY2U6c2VjcmV0LXZhbHVl');
    expect(requests[0].headers.SOAPAction).toContain('GetDeviceInformation');
    expect(requests[1].body).toContain('GetCapabilities');
    expect(JSON.stringify(report)).not.toContain('alice');
    expect(JSON.stringify(report)).not.toContain('secret-value');
    expect(JSON.stringify(report)).not.toContain('cloud.example.invalid');
  });

  it('classifies a SOAP authentication fault based on whether credentials were supplied', async () => {
    const unauthenticatedTransport: OnvifTransport = {
      request: vi.fn(async () => ({ status: 500, body: NOT_AUTHORIZED_FAULT })),
    };
    const withCredentialsTransport: OnvifTransport = {
      request: vi.fn(async () => ({ status: 500, body: NOT_AUTHORIZED_FAULT })),
    };

    const unauthenticated = await new OnvifDeviceProbe(unauthenticatedTransport).probe({
      endpoint: { host: '192.168.50.8' },
    });
    const withCredentials = await new OnvifDeviceProbe(withCredentialsTransport).probe({
      endpoint: { host: '192.168.50.8' },
      credentials: { username: 'operator', password: 'range-pass' },
    });

    expect(unauthenticated.status).toBe('authentication-required');
    expect(withCredentials.status).toBe('authentication-failed');
    expect(withCredentials.attempts[0].fault?.subcode).toBe('ter:NotAuthorized');
  });

  it('does not attempt a second operation for an unavailable Device service', async () => {
    const transport: OnvifTransport = {
      request: vi.fn(async () => ({ status: 404, body: 'not found' })),
    };
    const report = await new OnvifDeviceProbe(transport).probe({
      endpoint: { host: '192.168.50.8' },
    });

    expect(report.status).toBe('unsupported-service');
    expect(report.attempts).toHaveLength(1);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful HTTP response that is not an ONVIF Device reply', async () => {
    const transport: OnvifTransport = {
      request: vi.fn(async () => ({ status: 200, body: '<html>camera sign-in</html>' })),
    };
    const report = await new OnvifDeviceProbe(transport).probe({
      endpoint: { host: '192.168.50.8' },
    });

    expect(report.status).toBe('malformed-response');
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0].message).toContain('GetDeviceInformation');
  });

  it('contains no credential in transport failure diagnostics', async () => {
    const transport: OnvifTransport = {
      request: vi.fn(async () => {
        throw new Error('Connection rejected for range-user with pass=very-secret');
      }),
    };
    const report = await new OnvifDeviceProbe(transport).probe({
      endpoint: { host: '192.168.50.8' },
      credentials: { username: 'range-user', password: 'very-secret' },
    });

    expect(report.status).toBe('transport-error');
    expect(JSON.stringify(report)).not.toContain('range-user');
    expect(JSON.stringify(report)).not.toContain('very-secret');
  });

  it('parses namespace-qualified SOAP faults without retaining raw XML', () => {
    const fault = parseOnvifSoapFault(NOT_AUTHORIZED_FAULT);

    expect(fault).toMatchObject({
      code: 's:Sender',
      subcode: 'ter:NotAuthorized',
      reason: 'Authentication failed',
    });
    expect(classifyOnvifSoapFault(fault ?? {}, false)).toBe('authentication-required');
  });
});
