/** Ошибка с HTTP-статусом — общая для сервера и функций. */
export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
