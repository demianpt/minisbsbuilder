<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Package {
	private const MAX_UPLOAD_BYTES = 33554432; // 32 MB.
	private const MAX_JSON_BYTES   = 12582912; // 12 MB per JSON artifact.
	private const MAX_ZIP_BYTES    = 67108864; // 64 MB uncompressed.
	private const MAX_ZIP_ENTRIES  = 24;
	private const ALLOWED_NAMES    = array(
		'navigation.json',
		'footer.json',
		'page.json',
		'complete-project.json',
		'website.html',
	);

	/** @return array{artifacts:array<string,array>,source_name:string,warnings:array<int,string>}|WP_Error */
	public static function from_upload( array $file ) {
		if ( empty( $file['tmp_name'] ) || ! isset( $file['error'] ) ) {
			return new WP_Error( 'sbs_missing_upload', __( 'Choose a project ZIP or SBS JSON file.', 'sbs-website-importer' ) );
		}
		if ( UPLOAD_ERR_OK !== (int) $file['error'] ) {
			return new WP_Error( 'sbs_upload_error', sprintf( __( 'The upload failed with code %d.', 'sbs-website-importer' ), (int) $file['error'] ) );
		}
		if ( ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'sbs_invalid_upload', __( 'WordPress could not verify the uploaded file.', 'sbs-website-importer' ) );
		}
		if ( (int) $file['size'] > self::MAX_UPLOAD_BYTES ) {
			return new WP_Error( 'sbs_upload_too_large', __( 'The project package is larger than the 32 MB importer limit.', 'sbs-website-importer' ) );
		}

		$name = sanitize_file_name( (string) $file['name'] );
		$ext  = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( 'zip' === $ext ) {
			return self::from_zip( $file['tmp_name'], $name );
		}
		if ( 'json' === $ext ) {
			$raw = file_get_contents( $file['tmp_name'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			if ( false === $raw || strlen( $raw ) > self::MAX_JSON_BYTES ) {
				return new WP_Error( 'sbs_json_read', __( 'The JSON file could not be read or is too large.', 'sbs-website-importer' ) );
			}
			$data = self::decode_json( $raw, $name );
			if ( is_wp_error( $data ) ) {
				return $data;
			}
			$warnings = array();
			$artifacts = self::split_artifacts( $data, $warnings );
			if ( is_wp_error( $artifacts ) ) {
				return $artifacts;
			}
			return array( 'artifacts' => $artifacts, 'source_name' => $name, 'warnings' => $warnings );
		}
		return new WP_Error( 'sbs_file_type', __( 'Upload a .zip or .json file exported by the SBS Page Builder.', 'sbs-website-importer' ) );
	}

	private static function from_zip( string $path, string $name ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return self::from_pclzip( $path, $name );
		}
		$zip = new ZipArchive();
		if ( true !== $zip->open( $path ) ) {
			return new WP_Error( 'sbs_zip_open', __( 'The project ZIP could not be opened.', 'sbs-website-importer' ) );
		}
		if ( $zip->numFiles > self::MAX_ZIP_ENTRIES ) {
			$zip->close();
			return new WP_Error( 'sbs_zip_entries', __( 'The ZIP contains too many files.', 'sbs-website-importer' ) );
		}

		$total = 0;
		$found = array();
		for ( $i = 0; $i < $zip->numFiles; $i++ ) {
			$stat = $zip->statIndex( $i );
			if ( ! is_array( $stat ) ) {
				continue;
			}
			$entry = str_replace( '\\', '/', (string) $stat['name'] );
			if ( str_contains( $entry, '../' ) || str_starts_with( $entry, '/' ) || preg_match( '#^[A-Za-z]:/#', $entry ) ) {
				$zip->close();
				return new WP_Error( 'sbs_zip_path', __( 'The ZIP contains an unsafe file path.', 'sbs-website-importer' ) );
			}
			$total += (int) ( $stat['size'] ?? 0 );
			if ( $total > self::MAX_ZIP_BYTES ) {
				$zip->close();
				return new WP_Error( 'sbs_zip_size', __( 'The ZIP expands beyond the 64 MB importer limit.', 'sbs-website-importer' ) );
			}
			$base = strtolower( basename( $entry ) );
			if ( ! in_array( $base, self::ALLOWED_NAMES, true ) || 'website.html' === $base ) {
				continue;
			}
			$raw = $zip->getFromIndex( $i );
			if ( false === $raw || strlen( $raw ) > self::MAX_JSON_BYTES ) {
				$zip->close();
				return new WP_Error( 'sbs_zip_json_size', sprintf( __( '%s could not be read or is too large.', 'sbs-website-importer' ), esc_html( $base ) ) );
			}
			if ( isset( $found[ $base ] ) ) {
				$zip->close();
				return new WP_Error( 'sbs_zip_duplicate', sprintf( __( 'The ZIP contains more than one %s file.', 'sbs-website-importer' ), esc_html( $base ) ) );
			}
			$decoded = self::decode_json( $raw, $base );
			if ( is_wp_error( $decoded ) ) {
				$zip->close();
				return $decoded;
			}
			$found[ $base ] = $decoded;
		}
		$zip->close();

		return self::assemble_zip_artifacts( $found, $name );
	}

	private static function from_pclzip( string $path, string $name ) {
		if ( ! class_exists( 'PclZip' ) ) {
			$pclzip = ABSPATH . 'wp-admin/includes/class-pclzip.php';
			if ( is_file( $pclzip ) ) {
				require_once $pclzip;
			}
		}
		if ( ! class_exists( 'PclZip' ) ) {
			return new WP_Error( 'sbs_zip_missing', __( 'WordPress could not load a ZIP reader for the complete project bundle.', 'sbs-website-importer' ) );
		}
		$zip = new PclZip( $path );
		$list = $zip->listContent();
		if ( 0 === $list || ! is_array( $list ) ) {
			return new WP_Error( 'sbs_zip_open', __( 'The project ZIP could not be opened.', 'sbs-website-importer' ) );
		}
		if ( count( $list ) > self::MAX_ZIP_ENTRIES ) {
			return new WP_Error( 'sbs_zip_entries', __( 'The ZIP contains too many files.', 'sbs-website-importer' ) );
		}
		$total = 0;
		$found = array();
		foreach ( $list as $stat ) {
			if ( ! is_array( $stat ) || ! empty( $stat['folder'] ) ) {
				continue;
			}
			$entry = str_replace( '\\', '/', (string) ( $stat['filename'] ?? '' ) );
			if ( str_contains( $entry, '../' ) || str_starts_with( $entry, '/' ) || preg_match( '#^[A-Za-z]:/#', $entry ) ) {
				return new WP_Error( 'sbs_zip_path', __( 'The ZIP contains an unsafe file path.', 'sbs-website-importer' ) );
			}
			$total += (int) ( $stat['size'] ?? 0 );
			if ( $total > self::MAX_ZIP_BYTES ) {
				return new WP_Error( 'sbs_zip_size', __( 'The ZIP expands beyond the 64 MB importer limit.', 'sbs-website-importer' ) );
			}
			$base = strtolower( basename( $entry ) );
			if ( ! in_array( $base, self::ALLOWED_NAMES, true ) || 'website.html' === $base ) {
				continue;
			}
			if ( isset( $found[ $base ] ) ) {
				return new WP_Error( 'sbs_zip_duplicate', sprintf( __( 'The ZIP contains more than one %s file.', 'sbs-website-importer' ), esc_html( $base ) ) );
			}
			$extracted = $zip->extract( PCLZIP_OPT_BY_NAME, $entry, PCLZIP_OPT_EXTRACT_AS_STRING );
			$raw = is_array( $extracted ) && isset( $extracted[0]['content'] ) ? $extracted[0]['content'] : false;
			if ( false === $raw || strlen( $raw ) > self::MAX_JSON_BYTES ) {
				return new WP_Error( 'sbs_zip_json_size', sprintf( __( '%s could not be read or is too large.', 'sbs-website-importer' ), esc_html( $base ) ) );
			}
			$decoded = self::decode_json( $raw, $base );
			if ( is_wp_error( $decoded ) ) {
				return $decoded;
			}
			$found[ $base ] = $decoded;
		}
		return self::assemble_zip_artifacts( $found, $name );
	}

	private static function assemble_zip_artifacts( array $found, string $name ) {
		$warnings  = array();
		$artifacts = array();
		foreach ( array( 'navigation', 'footer', 'page' ) as $type ) {
			$key = $type . '.json';
			if ( isset( $found[ $key ] ) ) {
				$split = self::split_artifacts( $found[ $key ], $warnings );
				if ( is_wp_error( $split ) ) {
					return $split;
				}
				$artifacts = array_replace( $artifacts, $split );
			}
		}
		if ( isset( $found['complete-project.json'] ) ) {
			$split = self::split_artifacts( $found['complete-project.json'], $warnings );
			if ( is_wp_error( $split ) ) {
				return $split;
			}
			$artifacts = array_replace( $split, $artifacts );
		}
		if ( empty( $artifacts ) ) {
			return new WP_Error( 'sbs_zip_empty', __( 'No navigation.json, footer.json, or page.json was found in the project ZIP.', 'sbs-website-importer' ) );
		}
		return array( 'artifacts' => $artifacts, 'source_name' => $name, 'warnings' => array_values( array_unique( $warnings ) ) );
	}

	private static function decode_json( string $raw, string $name ) {
		try {
			$data = json_decode( $raw, true, 512, JSON_THROW_ON_ERROR );
		} catch ( JsonException $e ) {
			return new WP_Error( 'sbs_json_invalid', sprintf( __( '%1$s is not valid JSON: %2$s', 'sbs-website-importer' ), esc_html( $name ), esc_html( $e->getMessage() ) ) );
		}
		if ( ! is_array( $data ) ) {
			return new WP_Error( 'sbs_json_shape', sprintf( __( '%s does not contain an SBS export object.', 'sbs-website-importer' ), esc_html( $name ) ) );
		}
		return $data;
	}

	/** @return array<string,array>|WP_Error */
	public static function split_artifacts( array $data, array &$warnings = array() ) {
		$artifacts = array();
		$type      = sanitize_key( (string) ( $data['artifactType'] ?? '' ) );
		if ( in_array( $type, array( 'page', 'navigation', 'footer' ), true ) ) {
			$artifacts[ $type ] = $data;
		}

		$concept = isset( $data['concept'] ) && is_array( $data['concept'] ) ? $data['concept'] : array();
		$global  = isset( $concept['global'] ) && is_array( $concept['global'] ) ? $concept['global'] : array();
		$parts   = isset( $concept['templateParts'] ) && is_array( $concept['templateParts'] ) ? $concept['templateParts'] : array();
		if ( isset( $concept['page']['sections'] ) && is_array( $concept['page']['sections'] ) ) {
			$artifacts['page'] = self::wrap_artifact( $data, 'page', array( 'page' => $concept['page'] ) );
		}
		$navigation = $global['navigation'] ?? $parts['navigation'] ?? null;
		if ( is_array( $navigation ) ) {
			$artifacts['navigation'] = self::wrap_artifact( $data, 'navigation', array( 'global' => array( 'navigation' => $navigation ), 'templateParts' => array( 'navigation' => $navigation ) ) );
		}
		$footer = $global['footer'] ?? $parts['footer'] ?? null;
		if ( is_array( $footer ) ) {
			$artifacts['footer'] = self::wrap_artifact( $data, 'footer', array( 'global' => array( 'footer' => $footer ), 'templateParts' => array( 'footer' => $footer ) ) );
		}

		if ( empty( $artifacts ) && isset( $concept['page']['sections'] ) ) {
			$artifacts['page'] = $data;
		}
		if ( empty( $artifacts ) ) {
			return new WP_Error( 'sbs_artifact_unknown', __( 'The JSON does not contain a recognized SBS page, navigation, footer, or complete project artifact.', 'sbs-website-importer' ) );
		}

		$schema = (string) ( $data['schemaVersion'] ?? '' );
		if ( '' === $schema || ! str_starts_with( $schema, 'dst-concept-export/' ) ) {
			$warnings[] = __( 'This file does not declare the expected dst-concept-export schema. It will be imported conservatively.', 'sbs-website-importer' );
		}
		return $artifacts;
	}

	private static function wrap_artifact( array $source, string $type, array $concept_fragment ): array {
		$out                 = $source;
		$out['artifactType'] = $type;
		$out['concept']      = array_merge(
			array(
				'id'       => $source['concept']['id'] ?? sanitize_title( $source['client']['name'] ?? 'sbs-import' ),
				'name'     => $source['concept']['name'] ?? ucfirst( $type ),
				'theme'    => $source['concept']['theme'] ?? array(),
				'archetype'=> $source['concept']['archetype'] ?? '',
			),
			$concept_fragment
		);
		return $out;
	}

	/** @return string[] */
	public static function collect_components( array $artifacts ): array {
		$components = array();
		$walk = static function ( $value ) use ( &$walk, &$components ): void {
			if ( ! is_array( $value ) ) {
				return;
			}
			if ( isset( $value['component'] ) && is_string( $value['component'] ) ) {
				$components[] = $value['component'];
			}
			foreach ( $value as $child ) {
				if ( is_array( $child ) ) {
					$walk( $child );
				}
			}
		};
		$walk( $artifacts );
		$components = array_values( array_unique( array_filter( $components ) ) );
		sort( $components );
		return $components;
	}
}
