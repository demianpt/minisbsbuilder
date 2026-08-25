<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Services {
	/** @return int|WP_Error */
	public static function import_page( array $artifact, string $content, array $options ) {
		$page = $artifact['concept']['page'] ?? array();
		$title = sanitize_text_field( (string) ( $options['page_title'] ?? $page['title'] ?? __( 'Imported SBS Page', 'sbs-website-importer' ) ) );
		$status = in_array( $options['page_status'] ?? 'draft', array( 'draft', 'publish', 'private' ), true ) ? $options['page_status'] : 'draft';
		$page_id = absint( $options['page_id'] ?? 0 );
		$mode = in_array( $options['page_mode'] ?? 'replace', array( 'replace', 'append' ), true ) ? $options['page_mode'] : 'replace';
		if ( $page_id ) {
			$post = get_post( $page_id );
			if ( ! $post || 'page' !== $post->post_type || ! current_user_can( 'edit_post', $page_id ) ) {
				return new WP_Error( 'sbs_page_target', __( 'The selected destination page is not available.', 'sbs-website-importer' ) );
			}
			$new_content = 'append' === $mode && trim( $post->post_content ) ? $post->post_content . "\n\n" . $content : $content;
			// Snapshot first: after the write the previous page is unrecoverable.
			SBS_Importer_History::replacing_post( $page_id );
			$result = wp_update_post( array( 'ID' => $page_id, 'post_content' => wp_slash( $new_content ), 'post_title' => $title ?: $post->post_title ), true );
		} else {
			$result = wp_insert_post( array( 'post_type' => 'page', 'post_status' => $status, 'post_title' => $title, 'post_name' => sanitize_title( $page['slug'] ?? $title ), 'post_content' => wp_slash( $content ) ), true );
			if ( ! is_wp_error( $result ) ) {
				SBS_Importer_History::created_post( (int) $result, 'page' );
			}
		}
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		update_post_meta( $result, '_sbs_imported_at', current_time( 'mysql', true ) );
		update_post_meta( $result, '_sbs_artifact_version', sanitize_text_field( (string) ( $artifact['artifactVersion'] ?? $artifact['schemaVersion'] ?? '' ) ) );
		update_post_meta( $result, '_sbs_pattern_flow', sanitize_text_field( (string) ( $page['flow']['id'] ?? '' ) ) );
		return (int) $result;
	}

	/**
	 * Builds every menu the artifact names and assigns it to its theme location.
	 *
	 * The theme's menu blocks read a *location* — `menuSource: 'location'`,
	 * `menuLocation: 'primary-menu'` — not a list of links and not a menu id. So
	 * a menu that exists but is assigned nowhere renders as nothing, which is what
	 * an imported header used to do: the 1.0 importer created one menu and wrote
	 * its id into a `menuValue` attribute the theme's block does not declare.
	 *
	 * @return array<string,int>|WP_Error location => menu id
	 */
	public static function create_navigation_menus( array $artifact, string $prefix ) {
		$node = $artifact['concept']['global']['navigation'] ?? $artifact['concept']['templateParts']['navigation'] ?? array();
		$plan = isset( $node['menus'] ) && is_array( $node['menus'] ) ? $node['menus'] : array();
		if ( ! $plan ) {
			// A 1.0 artifact: one menu, from the shorthand, into the primary location.
			$legacy = self::create_navigation_menu( $artifact, $prefix );
			if ( is_wp_error( $legacy ) ) {
				return $legacy;
			}
			$plan_locations = array( 'primary-menu' => (int) $legacy );
			self::assign_menu_locations( $plan_locations );
			return $plan_locations;
		}

		$assigned = array();
		foreach ( $plan as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$location = sanitize_key( (string) ( $entry['location'] ?? '' ) );
			$items = isset( $entry['items'] ) && is_array( $entry['items'] ) ? $entry['items'] : array();
			if ( '' === $location || ! $items ) {
				continue;
			}
			$name = sanitize_text_field( (string) ( $entry['name'] ?? $location ) );
			$title = trim( $prefix ) ? trim( $prefix ) . ' — ' . $name : $name;
			$menu_id = self::upsert_menu( $title, $items );
			if ( is_wp_error( $menu_id ) ) {
				return $menu_id;
			}
			$assigned[ $location ] = (int) $menu_id;
		}
		self::assign_menu_locations( $assigned );
		return $assigned;
	}

	/**
	 * One menu, replaced rather than appended to.
	 *
	 * Re-importing the same project twice used to double every menu, because the
	 * items were added to a menu that already had them.
	 *
	 * @param array<int,array> $items
	 * @return int|WP_Error
	 */
	private static function upsert_menu( string $title, array $items ) {
		$menu = wp_get_nav_menu_object( $title );
		if ( $menu ) {
			$menu_id = (int) $menu->term_id;
			foreach ( wp_get_nav_menu_items( $menu_id ) ?: array() as $item ) {
				wp_delete_post( $item->ID, true );
			}
		} else {
			$menu_id = wp_create_nav_menu( $title );
			if ( ! is_wp_error( $menu_id ) ) {
				SBS_Importer_History::created_menu( (int) $menu_id, $title );
			}
			if ( is_wp_error( $menu_id ) ) {
				return $menu_id;
			}
		}
		foreach ( $items as $position => $item ) {
			if ( ! is_array( $item ) || empty( $item['label'] ) ) {
				continue;
			}
			$created = wp_update_nav_menu_item(
				(int) $menu_id,
				0,
				array(
					'menu-item-title'    => sanitize_text_field( (string) $item['label'] ),
					'menu-item-url'      => esc_url_raw( (string) ( $item['url'] ?? '#' ) ),
					'menu-item-status'   => 'publish',
					'menu-item-type'     => 'custom',
					'menu-item-position' => (int) $position + 1,
				)
			);
			if ( is_wp_error( $created ) ) {
				return $created;
			}
		}
		return (int) $menu_id;
	}

	/**
	 * Points the theme's registered locations at the menus just built.
	 *
	 * Locations the theme has not registered are skipped rather than written: a
	 * stray key in `nav_menu_locations` is invisible and confusing, and the theme
	 * is the authority on which locations exist.
	 *
	 * @param array<string,int> $locations
	 */
	private static function assign_menu_locations( array $locations ): void {
		if ( ! $locations ) {
			return;
		}
		$registered = array_keys( get_registered_nav_menus() );
		$current = get_theme_mod( 'nav_menu_locations', array() );
		$current = is_array( $current ) ? $current : array();
		foreach ( $locations as $location => $menu_id ) {
			if ( $registered && ! in_array( $location, $registered, true ) ) {
				continue;
			}
			$current[ $location ] = (int) $menu_id;
		}
		SBS_Importer_History::replacing_theme_mod( 'nav_menu_locations' );
		set_theme_mod( 'nav_menu_locations', $current );
	}

	/** @return int|WP_Error */
	public static function create_navigation_menu( array $artifact, string $title ) {
		$node = $artifact['concept']['global']['navigation'] ?? $artifact['concept']['templateParts']['navigation'] ?? array();
		$items = $node['nav']['menu'] ?? array();
		$title = sanitize_text_field( $title ?: __( 'SBS Primary Navigation', 'sbs-website-importer' ) );
		$menu = wp_get_nav_menu_object( $title );
		if ( $menu ) {
			$menu_id = (int) $menu->term_id;
			foreach ( wp_get_nav_menu_items( $menu_id ) ?: array() as $item ) {
				wp_delete_post( $item->ID, true );
			}
		} else {
			$menu_id = wp_create_nav_menu( $title );
			if ( ! is_wp_error( $menu_id ) ) {
				SBS_Importer_History::created_menu( (int) $menu_id, $title );
			}
			if ( is_wp_error( $menu_id ) ) {
				return $menu_id;
			}
		}
		foreach ( $items as $position => $item ) {
			if ( ! is_array( $item ) || empty( $item['label'] ) ) {
				continue;
			}
			$menu_item = wp_update_nav_menu_item(
				$menu_id,
				0,
				array(
					'menu-item-title'     => sanitize_text_field( (string) $item['label'] ),
					'menu-item-url'       => esc_url_raw( (string) ( $item['url'] ?? '#' ) ),
					'menu-item-status'    => 'publish',
					'menu-item-type'      => 'custom',
					'menu-item-position'  => (int) $position + 1,
				)
			);
			if ( is_wp_error( $menu_item ) ) {
				return $menu_item;
			}
		}
		return (int) $menu_id;
	}

	/** @return int|WP_Error */
	public static function upsert_template_part( string $slug, string $title, string $area, string $content ) {
		$slug = sanitize_title( $slug );
		$area = in_array( $area, array( 'header', 'footer', 'uncategorized' ), true ) ? $area : 'uncategorized';
		$theme = get_stylesheet();
		$existing = get_posts(
			array(
				'post_type'      => 'wp_template_part',
				'post_status'    => array( 'publish', 'draft', 'auto-draft' ),
				'name'           => $slug,
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'tax_query'      => array(
					array( 'taxonomy' => 'wp_theme', 'field' => 'name', 'terms' => $theme ),
				),
			)
		);
		$postarr = array( 'post_type' => 'wp_template_part', 'post_status' => 'publish', 'post_name' => $slug, 'post_title' => sanitize_text_field( $title ), 'post_content' => wp_slash( $content ) );
		if ( $existing ) {
			$postarr['ID'] = (int) $existing[0];
			// The header a site already had is the thing an undo most needs back.
			SBS_Importer_History::replacing_post( (int) $existing[0] );
			$id = wp_update_post( $postarr, true );
		} else {
			$id = wp_insert_post( $postarr, true );
			if ( ! is_wp_error( $id ) ) {
				SBS_Importer_History::created_post( (int) $id, 'template_part' );
			}
		}
		if ( is_wp_error( $id ) ) {
			return $id;
		}
		$theme_terms = wp_set_object_terms( $id, $theme, 'wp_theme', false );
		if ( is_wp_error( $theme_terms ) ) {
			return $theme_terms;
		}
		$area_terms = wp_set_object_terms( $id, $area, 'wp_template_part_area', false );
		if ( is_wp_error( $area_terms ) ) {
			return $area_terms;
		}
		update_post_meta( $id, 'origin', 'sbs-website-importer' );
		update_post_meta( $id, '_sbs_imported_at', current_time( 'mysql', true ) );
		return (int) $id;
	}

	public static function template_part_editor_url( string $slug ): string {
		$id = get_stylesheet() . '//' . sanitize_title( $slug );
		return admin_url( 'site-editor.php?postId=' . rawurlencode( $id ) . '&postType=wp_template_part&canvas=edit' );
	}

	public static function artifact_theme( array $artifacts ): array {
		foreach ( array( 'page', 'navigation', 'footer' ) as $type ) {
			if ( ! empty( $artifacts[ $type ]['concept']['theme'] ) && is_array( $artifacts[ $type ]['concept']['theme'] ) ) {
				return $artifacts[ $type ]['concept']['theme'];
			}
		}
		return array();
	}
}
