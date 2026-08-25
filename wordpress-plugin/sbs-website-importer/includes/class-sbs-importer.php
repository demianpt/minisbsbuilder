<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer {
	private static ?SBS_Importer $instance = null;

	public static function instance(): SBS_Importer {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public static function activate(): void {
		if ( version_compare( PHP_VERSION, '8.0', '<' ) ) {
			deactivate_plugins( plugin_basename( SBS_IMPORTER_FILE ) );
			wp_die( esc_html__( 'SBS Website Importer requires PHP 8.0 or newer.', 'sbs-website-importer' ) );
		}
	}

	private function __construct() {
		new SBS_Importer_Admin();
		SBS_Importer_Theme::register_hooks();
		add_action( 'init', array( 'SBS_Importer_Stage_Store', 'cleanup' ), 50 );
	}
}
