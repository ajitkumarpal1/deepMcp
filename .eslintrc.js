module.exports = {
  env: {
    node:  true,
    es2022: true,
    jest:  true,
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    // Catch silent errors
    'no-unused-vars':     ['warn', { argsIgnorePattern: '^_' }],
    'no-undef':           'error',
    'no-console':         'off', // project uses console intentionally in CLI mode

    // Safety
    'no-eval':            'error',
    'no-new-func':        'error',
    'no-implied-eval':    'error',

    // Style
    'eqeqeq':             ['error', 'always'],
    'curly':              ['error', 'multi-line'],
    'prefer-const':       'warn',
    'no-var':             'error',
  },
};
