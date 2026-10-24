import config from './capacitor.config.json' with { type: 'json' };

// Keep the ordinary config intact; only ios:submission opts into this artifact.
export default {
  ...config,
  webDir: process.env.FIXLIST_SUBMISSION === '1' ? 'dist-submission' : config.webDir,
};
