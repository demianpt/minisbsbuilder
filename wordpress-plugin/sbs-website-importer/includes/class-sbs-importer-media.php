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
			/*
			 * `sizes` is derived, never a source.
			 *
			 * It is the map of thumbnails *this* WordPress made, written by
			 * `attach_sizes` below, and every entry is a local URL. Walking into it
			 * asks the importer to fetch seven copies of a file it already has —
			 * from its own domain, which on a local site means a self-signed
			 * certificate and seven failures — and each attempt counts against the
			 * asset budget, so a page with a few photographs exhausted it and every
			 * image after that arrived as an empty frame.
			 */
			if ( 'sizes' === strtolower( (string) $key ) ) {
				continue;
			}
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
				$this->attach_sizes( $value, $attachment_id );
			}
		}
	}

	/**
	 * The registered sizes of an attachment, which the media component demands.
	 *
	 * `templates/components-shared/media/dst-media.php` will not draw a picture
	 * unless `imagePrimary.sizes` is a non-empty array:
	 *
	 *     'image' === $primary_type && ! empty( $args['imagePrimary']['id'] )
	 *         && ( ! empty( $args['imagePrimary']['sizes'] ) || $is_svg_primary )
	 *
	 * The builder cannot supply it — it is a map of the sizes *this* WordPress
	 * generated when the file was uploaded, and it does not exist until the
	 * sideload has happened. So every `c-media` block imported as a correctly
	 * classed, correctly sized, completely empty `<figure>`: the block was there,
	 * the attachment was there, the alt text was there, and no image was drawn.
	 * Nothing warned, because nothing was missing as far as the importer knew.
	 *
	 * `Ds_Media_Helpers::convert_sizes_to_acf_format` reads `$size['url']` out of
	 * each entry, so that is the shape written here, with the dimensions the
	 * theme's own picture template also reads.
	 */
	private function attach_sizes( array &$value, int $attachment_id ): void {
		if ( ! empty( $value['sizes'] ) || ! wp_attachment_is_image( $attachment_id ) ) {
			return;
		}
		$sizes = array();
		foreach ( array_merge( array( 'full' ), get_intermediate_image_sizes() ) as $name ) {
			$src = wp_get_attachment_image_src( $attachment_id, $name );
			if ( ! $src || empty( $src[0] ) ) {
				continue;
			}
			$sizes[ $name ] = array(
				'url'    => $src[0],
				'width'  => (int) $src[1],
				'height' => (int) $src[2],
			);
		}
		if ( $sizes ) {
			$value['sizes'] = $sizes;
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
		/*
		 * A file this site already hosts is not something to download.
		 *
		 * Re-importing a page hands back the URLs of the attachments the last
		 * import created. Fetching them again would duplicate the whole media
		 * library, and over a local domain's self-signed certificate it does not
		 * even succeed — it just spends the budget and loses the picture.
		 */
		$local = attachment_url_to_postid( $url );
		if ( $local ) {
			return (int) $local;
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
