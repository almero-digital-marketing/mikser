var constants = require('node-constants');

constants.define(exports, 'RENDER_STRATEGY_PREVIEW', 0);
constants.define(exports, 'RENDER_STRATEGY_STANDALONE', 1);
constants.define(exports, 'RENDER_STRATEGY_FULL', 2);
constants.define(exports, 'RENDER_STRATEGY_FORCE', 3);
constants.define(exports, 'DIAGNOSTICS_FAIL', -1);
constants.define(exports, 'DIAGNOSTICS_NONE', 0);
constants.define(exports, 'DIAGNOSTICS_SUCCESS', 1);
constants.define(exports, 'DIAGNOSTICS_NOTICE', 2);