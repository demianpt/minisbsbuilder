import DST_SHARED_CSS from './styles/dst-shared.css?raw';
import './styles/app.css';
import * as briefBrainFeature from './features/brief-brain/index.js';
import { buttonStyleEditorCss } from '../shared/design/button-styles.mjs';
import { initializeBuilder } from './runtime/builder.js';

/**
 * The button-style swatches in Step 02 use the same CSS the rendered page does.
 * Injecting it from the shared module — rather than duplicating it in app.css —
 * is what stops the editor preview from drifting away from the real output.
 */
function installButtonStyleSwatchCss() {
  const style = document.createElement('style');
  style.id = 'sbs-button-style-swatches';
  style.textContent = buttonStyleEditorCss();
  document.head.append(style);
}

/** Load the large, rarely changing pattern catalog on demand. */
async function bootstrap() {
  installButtonStyleSwatchCss();
  const [{ default: catalog }, { default: styleLibrary }] = await Promise.all([
    import('./data/dst-data.json'),
    import('./data/style-library.json'),
  ]);
  initializeBuilder(catalog, DST_SHARED_CSS, briefBrainFeature, { styleLibrary });
}

bootstrap();
