import { createTransport } from 'nodemailer';
import type { Config } from './config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Envoi d'e-mails : facultatif (SMTP de votre propre boîte, gratuit). */
export interface Mailer {
  readonly enabled: boolean;
  send(msg: MailMessage): Promise<void>;
}

export class NullMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error("L'envoi d'e-mails n'est pas configuré sur ce serveur.");
  }
}

export class SmtpMailer implements Mailer {
  readonly enabled = true;
  private transport;
  constructor(
    url: string,
    private from: string,
  ) {
    this.transport = createTransport(url);
  }
  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text });
  }
}

/** Boîte aux lettres en mémoire (tests). */
export class MemoryMailer implements Mailer {
  readonly enabled = true;
  sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

export function mailerFromConfig(config: Config): Mailer {
  if (!config.smtpUrl) return new NullMailer();
  return new SmtpMailer(config.smtpUrl, config.mailFrom ?? 'HOMEOS <homeos@localhost>');
}
