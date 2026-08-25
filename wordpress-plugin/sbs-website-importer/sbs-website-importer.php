<?php
/**
 * Plugin Name:       SBS Website Importer
 * Plugin URI:        https://www.digitalsilk.com/
 * Description:       Imports SBS Page Builder project bundles into native Digital Silk Gutenberg blocks, pages, and editable Header/Footer template parts.
 * Version:           3.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            Digital Silk
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       sbs-website-importer
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SBS_IMPORTER_VERSION', '3.0.0' );
define( 'SBS_IMPORTER_FILE', __FILE__ );
define( 'SBS_IMPORTER_DIR', plugin_dir_path( __FILE__ ) );
define( 'SBS_IMPORTER_URL', plugin_dir_url( __FILE__ ) );

require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-history.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-package.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-stage-store.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-block-contract.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-block-converter.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-media.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-theme.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-services.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer-admin.php';
require_once SBS_IMPORTER_DIR . 'includes/class-sbs-importer.php';

register_activation_hook( __FILE__, array( 'SBS_Importer', 'activate' ) );
add_action( 'plugins_loaded', array( 'SBS_Importer', 'instance' ) );
