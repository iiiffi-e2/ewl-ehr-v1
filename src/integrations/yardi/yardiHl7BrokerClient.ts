import type { AxiosInstance } from 'axios';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  buildGetMessageRequestXml,
  buildProcessAckXml,
  classifyGetMessageResponse,
  formatBrokerResponseBodyForLog,
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
        sendingApplication: env.YARDI_HL7_SENDING_APPLICATION,
        sendingFacility: env.YARDI_HL7_SENDING_FACILITY,
        receivingApplication: env.YARDI_HL7_RECEIVING_APPLICATION,
        receivingFacility: env.YARDI_HL7_RECEIVING_FACILITY,
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
    if (response.status < 200 || response.status >= 300) {
      return { kind: 'error', detail: `http_${response.status}` };
    }
    const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    const classification = classifyGetMessageResponse(data);
    if (classification.kind === 'error') {
      logger.warn(
        {
          detail: classification.detail,
          url: this.options.getMessageUrl,
          ...formatBrokerResponseBodyForLog(data, [this.options.identity.password]),
        },
        'yardi_hl7_get_message_unclassified',
      );
    }
    return classification;
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
