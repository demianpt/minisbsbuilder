<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Stage_Store {
	private const TTL = 3600;

	/** @return string|WP_Error */
	public static function put( array $payload ) {
		$token = wp_generate_uuid4();
		$path  = self::path( $token, true );
		$data  = array(
			'user_id'    => get_current_user_id(),
			'created_at' => time(),
			'expires_at' => time() + self::TTL,
			'payload'    => $payload,
		);
		$written = file_put_contents( $path, wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ), LOCK_EX ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		if ( false === $written ) {
			return new WP_Error( 'sbs_stage_write', __( 'WordPress could not stage the import. Check the uploads directory permissions.', 'sbs-website-importer' ) );
		}
		return $token;
	}

	public static function get( string $token ) {
		if ( ! preg_match( '/^[a-f0-9-]{36}$/i', $token ) ) {
			return new WP_Error( 'sbs_stage_token', __( 'The staged import reference is invalid.', 'sbs-website-importer' ) );
		}
		$path = self::path( $token, false );
		if ( ! is_file( $path ) ) {
			return new WP_Error( 'sbs_stage_missing', __( 'The staged import has expired. Upload the project again.', 'sbs-website-importer' ) );
		}
		$raw = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$data = json_decode( (string) $raw, true );
		if ( ! is_array( $data ) || (int) ( $data['user_id'] ?? 0 ) !== get_current_user_id() || (int) ( $data['expires_at'] ?? 0 ) < time() ) {
			@unlink( $path );
			return new WP_Error( 'sbs_stage_expired', __( 'The staged import has expired. Upload the project again.', 'sbs-website-importer' ) );
		}
		return $data['payload'] ?? array();
	}

	public static function delete( string $token ): void {
		$path = self::path( $token, false );
		if ( is_file( $path ) ) {
			@unlink( $path );
		}
	}

	public static function cleanup(): void {
		$dir = dirname( self::path( 'placeholder', true ) );
		foreach ( glob( $dir . '/*.json' ) ?: array() as $file ) {
			if ( filemtime( $file ) < time() - self::TTL ) {
				@unlink( $file );
			}
		}
	}

	private static function path( string $token, bool $create ): string {
		$uploads = wp_upload_dir();
		$dir     = trailingslashit( $uploads['basedir'] ) . 'sbs-importer/staging';
		if ( $create && ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			if ( ! file_exists( $dir . '/index.php' ) ) {
				file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
			}
		}
		return trailingslashit( $dir ) . sanitize_file_name( $token ) . '.json';
	}
}
