<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Media {
	private const MAX_ASSETS = 80;
	private int $processed = 0;
	private array $warnings = array();

	/** @return array<int,string> */
	public function sideload_artifacts( array &$artifacts ): array {
		if ( ! function_exists( 'download_url' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( ! function_exists( 'media_handle_sideload' ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}
		$this->walk( $artifacts, array() );
		return array_values( array_unique( $this->warnings ) );
	}

	public function sideload_logo_url( string $url, string $alt = '' ) {
		if ( '' === $url ) {
			return 0;
		}
		return $this->sideload_url( $url, $alt );
	}

	private function walk( array &$value, array $path ): void {
		foreach ( $value as $key => &$child ) {
			$current_path = array_merge( $path, array( (string) $key ) );
			if ( is_array( $child ) ) {
				$this->walk( $child, $current_path );
				continue;
			}
			if ( ! is_string( $child ) || ! in_array( strtolower( (string) $key ), array( 'url', 'src' ), true ) || ! $this->looks_like_media_path( $current_path ) ) {
				continue;
			}
			if ( ! preg_match( '#^https?://#i', $child ) ) {
				continue;
			}
			if ( $this->processed >= self::MAX_ASSETS ) {
				$this->warnings[] = __( 'The media sideload limit was reached; remaining remote media URLs were preserved.', 'sbs-website-importer' );
				return;
			}
			$alt = '';
			if ( isset( $value['alt'] ) && is_string( $value['alt'] ) ) {
				$alt = $value['alt'];
			} elseif ( isset( $value['title'] ) && is_string( $value['title'] ) ) {
				$alt = $value['title'];
			}
			$attachment_id = $this->sideload_url( $child, $alt );
			if ( is_wp_error( $attachment_id ) ) {
				$this->warnings[] = sprintf( __( 'Could not sideload %1$s: %2$s', 'sbs-website-importer' ), esc_url_raw( $child ), $attachment_id->get_error_message() );
				continue;
			}
			if ( $attachment_id ) {
				$child = wp_get_attachment_url( $attachment_id );
				if ( array_key_exists( 'id', $value ) ) {
					$value['id'] = $attachment_id;
				}
			}
		}
	}

	private function looks_like_media_path( array $path ): bool {
		$joined = strtolower( implode( '.', $path ) );
		if ( str_contains( $joined, 'link' ) || str_contains( $joined, 'button' ) || str_contains( $joined, 'menuitems' ) || str_contains( $joined, 'socialnetworks' ) ) {
			return false;
		}
		return (bool) preg_match( '/(?:media|image|background|poster|thumbnail|logo|icon|sizes|photo|avatar)/', $joined );
	}

	private function sideload_url( string $url, string $alt = '' ) {
		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( ! $url || ! wp_http_validate_url( $url ) ) {
			return new WP_Error( 'sbs_media_url', __( 'The media URL is not a valid public HTTP URL.', 'sbs-website-importer' ) );
		}
		$existing = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_key'       => '_sbs_source_url', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => $url, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		if ( $existing ) {
			return (int) $existing[0];
		}

		$this->processed++;
		$tmp = download_url( $url, 30 );
		if ( is_wp_error( $tmp ) ) {
			return $tmp;
		}
		$path = wp_parse_url( $url, PHP_URL_PATH );
		$name = sanitize_file_name( basename( (string) $path ) );
		if ( '' === $name || ! str_contains( $name, '.' ) ) {
			$name = 'sbs-imported-image-' . wp_generate_password( 8, false ) . '.jpg';
		}
		$file = array( 'name' => $name, 'tmp_name' => $tmp );
		$id = media_handle_sideload( $file, 0, $alt );
		if ( is_wp_error( $id ) ) {
			@unlink( $tmp );
			return $id;
		}
		update_post_meta( $id, '_sbs_source_url', $url );
		/*
		 * Recorded so an undo takes the pictures with it. Reused attachments — the
		 * branch above, matched on `_sbs_source_url` — are deliberately not
		 * recorded: this import did not create them and another page may be using
		 * them, so trashing them on undo would break a page nobody touched.
		 */
		SBS_Importer_History::created_post( (int) $id, 'attachment' );
		if ( '' !== $alt ) {
			update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
		}
		return (int) $id;
	}
}
