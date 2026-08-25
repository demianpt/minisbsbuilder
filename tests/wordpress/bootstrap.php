<?php
declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', dirname( __DIR__, 2 ) . '/' );
}

if ( ! class_exists( 'WP_Error' ) ) {
	final class WP_Error {
		private string $code;
		private string $message;
		public function __construct( string $code = '', string $message = '' ) { $this->code = $code; $this->message = $message; }
		public function get_error_message(): string { return $this->message; }
		public function get_error_code(): string { return $this->code; }
	}
}
if ( ! function_exists( 'is_wp_error' ) ) { function is_wp_error( $value ): bool { return $value instanceof WP_Error; } }
if ( ! function_exists( '__' ) ) { function __( string $text, string $domain = '' ): string { return $text; } }
if ( ! function_exists( 'sanitize_text_field' ) ) { function sanitize_text_field( $value ): string { return trim( preg_replace( '/[\r\n\t]+/', ' ', strip_tags( (string) $value ) ) ?? '' ); } }
if ( ! function_exists( 'sanitize_key' ) ) { function sanitize_key( $value ): string { return strtolower( preg_replace( '/[^a-zA-Z0-9_\-]/', '', (string) $value ) ?? '' ); } }
if ( ! function_exists( 'sanitize_title' ) ) { function sanitize_title( $value ): string { return trim( preg_replace( '/[^a-z0-9]+/', '-', strtolower( (string) $value ) ) ?? '', '-' ); } }
if ( ! function_exists( 'esc_attr' ) ) { function esc_attr( $value ): string { return htmlspecialchars( (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ); } }
if ( ! function_exists( 'esc_html' ) ) { function esc_html( $value ): string { return htmlspecialchars( (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ); } }
if ( ! function_exists( 'esc_url' ) ) { function esc_url( $value ): string { return filter_var( (string) $value, FILTER_SANITIZE_URL ) ?: ''; } }
if ( ! function_exists( 'wp_kses_post' ) ) { function wp_kses_post( $value ): string { return strip_tags( (string) $value, '<a><b><strong><em><i><span><br><p><ul><ol><li>' ); } }
if ( ! function_exists( 'wp_json_encode' ) ) { function wp_json_encode( $value, int $flags = 0 ): string { return json_encode( $value, $flags | JSON_THROW_ON_ERROR ); } }

if ( ! class_exists( 'WP_Block_Type_Registry' ) ) {
	final class WP_Block_Type_Registry {
		private static ?self $instance = null;
		private array $registered = array();
		public static function get_instance(): self { return self::$instance ??= new self(); }
		public function register_fixture( string $name, array $attributes, ?array $supports = null ): void {
			$type = array( 'attributes' => array_fill_keys( array_keys( $attributes ), array() ) );
			// `supports` is what a real site exposes and what the HOC attributes are
			// derived from; a fixture that omits it cannot reproduce production.
			if ( null !== $supports ) { $type['supports'] = $supports; }
			$this->registered[ $name ] = (object) $type;
		}
		public function forget_fixture( string $name ): void { unset( $this->registered[ $name ] ); }
		public function get_registered( string $name ) { return $this->registered[ $name ] ?? null; }
		public function is_registered( string $name ): bool { return isset( $this->registered[ $name ] ); }
	}
}

$root = dirname( __DIR__, 2 );
$data = json_decode( file_get_contents( $root . '/src/data/dst-data.json' ), true, 512, JSON_THROW_ON_ERROR );
$registry = WP_Block_Type_Registry::get_instance();
foreach ( (array) ( $data['registry'] ?? array() ) as $name => $definition ) {
	$attributes = array();
	foreach ( (array) ( $definition['attributes'] ?? array() ) as $attribute ) {
		if ( is_array( $attribute ) && isset( $attribute['name'] ) ) $attributes[ $attribute['name'] ] = true;
	}
	$registry->register_fixture( (string) $name, $attributes );
}
foreach ( array( 'core/paragraph', 'core/heading', 'core/list', 'core/list-item', 'core/html', 'gravityforms/form' ) as $core ) {
	$registry->register_fixture( $core, array( 'content' => true, 'className' => true, 'ordered' => true, 'level' => true, 'placeholder' => true ) );
}
