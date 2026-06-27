const logger = require('../src/utils/logger');

describe('logger', () => {
  let out, err;
  beforeEach(() => {
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    err = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
  });
  afterEach(() => { out.mockRestore(); err.mockRestore(); });

  it('logs info to stdout', () => {
    logger.info('test message');
    expect(out).toHaveBeenCalled();
  });
  it('logs error to stderr', () => {
    logger.error('test error');
    expect(err).toHaveBeenCalled();
  });
  it('includes timestamp in output', () => {
    logger.info('msg');
    const output = out.mock.calls[0][0];
    expect(output).toContain('T');
  });
  it('includes log level in output', () => {
    logger.warn('msg');
    const output = out.mock.calls[0][0];
    expect(output.toLowerCase()).toContain('warn');
  });
  it('includes meta fields', () => {
    logger.info('msg', { requestId: 'abc123' });
    const output = out.mock.calls[0][0];
    expect(output).toContain('abc123');
  });
});
