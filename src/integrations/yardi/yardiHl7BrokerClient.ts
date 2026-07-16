import type { AxiosInstance } from 'axios';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  buildGetMessageRequestXml,
  buildProcessAckXml,
  classifyGetMessageResponse,
  formatBrokerResponseBodyForLog,
  sanitizeXmlForLog,
  type GetMessageClassification,
  type YardiHl7BrokerIdentity,
} from './yardiHl7BrokerXml.js';

export type YardiHl7BrokerClientOptions = {
  getMessageUrl: string;
  processAckUrl: string;
  identity: YardiHl7BrokerIdentity;
  http?: AxiosInstance;
};

export class YardiHl7BrokerClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: YardiHl7BrokerClientOptions) {
    this.http =
      options.http ??
      createHttpClient({
        headers: { Accept: 'text/xml' },
      });
  }

  static fromEnv(): YardiHl7BrokerClient {
    if (!env.YARDI_HL7_MAILBOX_PASSWORD) {
      throw new Error('YARDI_HL7_MAILBOX_PASSWORD is required when using the HL7 broker client');
    }
    return new YardiHl7BrokerClient({
      getMessageUrl: env.YARDI_HL7_GET_MESSAGE_URL,
      processAckUrl: env.YARDI_HL7_PROCESS_ACK_URL,
      identity: {
        yardiApplicationId: env.YARDI_HL7_SENDING_APPLICATION,
        yardiFacilityId: env.YARDI_HL7_SENDING_FACILITY,
        pharmacySoftwareId: env.YARDI_HL7_RECEIVING_APPLICATION,
        pharmacyId: env.YARDI_HL7_RECEIVING_FACILITY,
        password: env.YARDI_HL7_MAILBOX_PASSWORD,
      },
    });
  }

  async getMessage(): Promise<GetMessageClassification> {
    const now = new Date();
    const stamp = formatHl7Timestamp(now);
    const body = buildGetMessageRequestXml({
      identity: this.options.identity,
      messageControlId: stamp,
      dateTime: stamp,
    });
    const response = await this.http.post<string>(this.options.getMessageUrl, body, {
      headers: { 'Content-Type': 'text/xml' },
      responseType: 'text',
      validateStatus: () => true,
    });
    const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');

    if (response.status < 200 || response.status >= 300) {
      this.logUnexpectedResponse(`http_${response.status}`, body, response, data);
      return { kind: 'error', detail: `http_${response.status}` };
    }

    const classification = classifyGetMessageResponse(data);
    if (classification.kind === 'error') {
      this.logUnexpectedResponse(classification.detail, body, response, data);
    }
    return classification;
  }

  private logUnexpectedResponse(
    detail: string | undefined,
    requestBody: string,
    response: { status: number; headers?: unknown },
    data: string,
  ): void {
    const headers = (response.headers ?? {}) as Record<string, unknown>;
    const password = this.options.identity.password;
    const redactedRequest = password
      ? requestBody.split(password).join('[REDACTED]')
      : requestBody;
    logger.warn(
      {
        detail,
        method: 'POST',
        url: this.options.getMessageUrl,
        requestPreview: sanitizeXmlForLog(requestBody, [password], {
          revealControlChars: true,
        }),
        // Verify the CR is serialized as the &#13; entity and NOT a raw CR byte.
        requestJson: JSON.stringify(redactedRequest),
        requestHasCharRef13: requestBody.includes('&#13;'),
        requestHasLiteralBackslashR: requestBody.includes('\\r'),
        requestHasRawCr: requestBody.includes('\r'),
        responseStatus: response.status,
        responseContentType: headers['content-type'],
        responseContentLength: headers['content-length'],
        responseServer: headers['server'],
        responseAllow: headers['allow'],
        ...formatBrokerResponseBodyForLog(data, [password]),
      },
      'yardi_hl7_get_message_unclassified',
    );
  }

  async processAck(adtMessage: string): Promise<void> {
    const body = buildProcessAckXml({
      adtMessage,
      identity: this.options.identity,
      password: this.options.identity.password,
    });
    const response = await this.http.post(this.options.processAckUrl, body, {
      headers: { 'Content-Type': 'text/xml' },
      responseType: 'text',
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`ProcessACK failed with HTTP ${response.status}`);
    }
  }
}

function formatHl7Timestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}
