<?php
/**
 * An import you can take back.
 *
 * An import writes in several places at once: the page, the header and footer
 * template parts, the navigation menus and their theme locations, the site logo,
 * and the theme's CSS variables. Before this existed, a strategist who imported
 * the wrong JSON — or the right JSON into the wrong page — had no way back. The
 * page could be found in the trash; the overwritten header could not.
 *
 * So every import records what it did:
 *
 *   created    posts this import brought into being — the page, the template
 *              parts, the sideloaded attachments. Undo trashes them, and redo
 *              restores them from the trash, which is why they are trashed
 *              rather than deleted.
 *   replaced   posts that already existed and were written over. The previous
 *              title and content are kept verbatim, so undo puts back exactly
 *              what was there.
 *   options    option and theme-mod values as they were before the import, for
 *              the site logo, the menu locations and the theme tokens.
 *   menus      nav menus this import created, deleted on undo.
 *
 * Undo and redo are symmetrical because both directions are stored: each entry
 * holds the value before and the value after, so moving between them is the same
 * operation with the ends swapped. Nothing is inferred at undo time.
 *
 * @package SBS_Website_Importer
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_History {

	private const OPTION = 'sbs_importer_history';

	/** How many imports to keep. Older ones drop off, oldest first. */
	private const KEEP = 20;

	/** @var array<string,mixed>|null the import being recorded, if any */
	private static ?array $current = null;

	/** Begins recording an import. */
	public static function start( string $label ): void {
		self::$current = array(
			'id'        => uniqid( 'sbs', true ),
			'label'     => sanitize_text_field( $label ),
			'when'      => current_time( 'mysql', true ),
			'user'      => get_current_user_id(),
			'created'   => array(),
			'replaced'  => array(),
			'options'   => array(),
			'themeMods' => array(),
			'menus'     => array(),
			'summary'   => array(),
			'undone'    => false,
		);
	}

	/** Whether an import is being recorded right now. */
	public static function recording(): bool {
		return null !== self::$current;
	}

	/**
	 * A post this import created.
	 *
	 * @param string $kind page|template_part|attachment, for the admin listing.
	 */
	public static function created_post( int $post_id, string $kind ): void {
		if ( null === self::$current || $post_id <= 0 ) {
			return;
		}
		self::$current['created'][] = array( 'id' => $post_id, 'kind' => sanitize_key( $kind ) );
	}

	/**
	 * A post this import is about to overwrite.
	 *
	 * Call before the write. The content is stored unslashed, exactly as the
	 * database holds it, so putting it back is a straight assignment.
	 */
	public static function replacing_post( int $post_id ): void {
		if ( null === self::$current || $post_id <= 0 ) {
			return;
		}
		foreach ( self::$current['replaced'] as $entry ) {
			if ( (int) $entry['id'] === $post_id ) {
				return; // the first snapshot is the one that predates the import
			}
		}
		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}
		self::$current['replaced'][] = array(
			'id'      => $post_id,
			'kind'    => sanitize_key( (string) $post->post_type ),
			'title'   => (string) $post->post_title,
			'content' => (string) $post->post_content,
			'status'  => (string) $post->post_status,
		);
	}

	/** An option this import is about to change. Call before the write. */
	public static function replacing_option( string $name ): void {
		if ( null === self::$current || isset( self::$current['options'][ $name ] ) ) {
			return;
		}
		$existing = get_option( $name, null );
		self::$current['options'][ $name ] = array( 'existed' => null !== $existing, 'value' => $existing );
	}

	/** A theme mod this import is about to change. Call before the write. */
	public static function replacing_theme_mod( string $name ): void {
		if ( null === self::$current || isset( self::$current['themeMods'][ $name ] ) ) {
			return;
		}
		$existing = get_theme_mod( $name, null );
		self::$current['themeMods'][ $name ] = array( 'existed' => null !== $existing, 'value' => $existing );
	}

	/** A nav menu this import created. */
	public static function created_menu( int $term_id, string $name ): void {
		if ( null === self::$current || $term_id <= 0 ) {
			return;
		}
		self::$current['menus'][] = array( 'id' => $term_id, 'name' => sanitize_text_field( $name ) );
	}

	/** Stores the recording and returns its id, or '' if nothing was recorded. */
	public static function finish( array $summary = array() ): string {
		if ( null === self::$current ) {
			return '';
		}
		$record = self::$current;
		self::$current = null;
		$touched = count( $record['created'] ) + count( $record['replaced'] )
			+ count( $record['options'] ) + count( $record['themeMods'] ) + count( $record['menus'] );
		if ( 0 === $touched ) {
			return '';
		}
		$record['summary'] = array_map( 'sanitize_text_field', array_map( 'strval', $summary ) );
		$history = self::all();
		array_unshift( $history, $record );
		$history = array_slice( $history, 0, self::KEEP );
		update_option( self::OPTION, $history, false );
		return (string) $record['id'];
	}

	/** Abandons the recording without storing it. */
	public static function discard(): void {
		self::$current = null;
	}

	/** @return array<int,array<string,mixed>> newest first */
	public static function all(): array {
		$stored = get_option( self::OPTION, array() );
		return is_array( $stored ) ? $stored : array();
	}

	/**
	 * Puts the site back to how it was before this import.
	 *
	 * @return array{restored:int,trashed:int,messages:array<int,string>}|WP_Error
	 */
	public static function undo( string $id ) {
		$history = self::all();
		$at = self::find( $history, $id );
		if ( null === $at ) {
			return new WP_Error( 'sbs_history_missing', __( 'That import is no longer in the history.', 'sbs-website-importer' ) );
		}
		$record = $history[ $at ];
		if ( ! empty( $record['undone'] ) ) {
			return new WP_Error( 'sbs_history_undone', __( 'That import has already been undone.', 'sbs-website-importer' ) );
		}

		$messages = array();
		$trashed = 0;
		$restored = 0;

		/*
		 * The forward state is captured on the way out, so redo does not have to
		 * re-run the import: it is the same restore in the other direction.
		 */
		foreach ( $record['replaced'] as $index => $entry ) {
			$post = get_post( (int) $entry['id'] );
			if ( ! $post ) {
				$messages[] = sprintf( __( 'Post %d is gone, so its previous content could not be put back.', 'sbs-website-importer' ), (int) $entry['id'] );
				continue;
			}
			$history[ $at ]['replaced'][ $index ]['after'] = array(
				'title'   => (string) $post->post_title,
				'content' => (string) $post->post_content,
				'status'  => (string) $post->post_status,
			);
			wp_update_post(
				array(
					'ID'           => (int) $entry['id'],
					'post_title'   => $entry['title'],
					'post_content' => wp_slash( $entry['content'] ),
					'post_status'  => $entry['status'],
				)
			);
			$restored++;
		}

		foreach ( $record['created'] as $entry ) {
			if ( get_post( (int) $entry['id'] ) ) {
				wp_trash_post( (int) $entry['id'] );
				$trashed++;
			}
		}

		foreach ( $record['options'] as $name => $entry ) {
			$history[ $at ]['options'][ $name ]['after'] = get_option( $name, null );
			if ( empty( $entry['existed'] ) ) {
				delete_option( $name );
			} else {
				update_option( $name, $entry['value'], false );
			}
			$restored++;
		}

		foreach ( $record['themeMods'] as $name => $entry ) {
			$history[ $at ]['themeMods'][ $name ]['after'] = get_theme_mod( $name, null );
			if ( empty( $entry['existed'] ) ) {
				remove_theme_mod( $name );
			} else {
				set_theme_mod( $name, $entry['value'] );
			}
			$restored++;
		}

		foreach ( $record['menus'] as $entry ) {
			if ( function_exists( 'wp_delete_nav_menu' ) ) {
				wp_delete_nav_menu( (int) $entry['id'] );
			}
		}

		$history[ $at ]['undone'] = true;
		$history[ $at ]['undoneAt'] = current_time( 'mysql', true );
		update_option( self::OPTION, $history, false );

		return array( 'restored' => $restored, 'trashed' => $trashed, 'messages' => $messages );
	}

	/**
	 * Puts back what the undo took away.
	 *
	 * Only the parts an undo captured on its way out: untrashing the posts the
	 * import created and re-applying the content and settings it wrote. A menu
	 * the undo deleted is not recreated — a nav menu's items belong to it, and
	 * inventing new ones would be a different menu wearing the same name. The
	 * caller is told so rather than left to discover it.
	 *
	 * @return array{restored:int,untrashed:int,messages:array<int,string>}|WP_Error
	 */
	public static function redo( string $id ) {
		$history = self::all();
		$at = self::find( $history, $id );
		if ( null === $at ) {
			return new WP_Error( 'sbs_history_missing', __( 'That import is no longer in the history.', 'sbs-website-importer' ) );
		}
		$record = $history[ $at ];
		if ( empty( $record['undone'] ) ) {
			return new WP_Error( 'sbs_history_not_undone', __( 'That import has not been undone, so there is nothing to put back.', 'sbs-website-importer' ) );
		}

		$messages = array();
		$untrashed = 0;
		$restored = 0;

		foreach ( $record['created'] as $entry ) {
			$post = get_post( (int) $entry['id'] );
			if ( ! $post ) {
				$messages[] = sprintf( __( 'Post %d was deleted from the trash and cannot be brought back.', 'sbs-website-importer' ), (int) $entry['id'] );
				continue;
			}
			if ( 'trash' === $post->post_status ) {
				wp_untrash_post( (int) $entry['id'] );
				/*
				 * `wp_untrash_post` restores to `draft` on modern WordPress, which
				 * would quietly unpublish an imported page. The status the import
				 * left it in is what gets restored.
				 */
				wp_update_post( array( 'ID' => (int) $entry['id'], 'post_status' => 'attachment' === $entry['kind'] ? 'inherit' : 'publish' ) );
				$untrashed++;
			}
		}

		foreach ( $record['replaced'] as $entry ) {
			if ( ! isset( $entry['after'] ) || ! is_array( $entry['after'] ) ) {
				continue;
			}
			if ( ! get_post( (int) $entry['id'] ) ) {
				continue;
			}
			wp_update_post(
				array(
					'ID'           => (int) $entry['id'],
					'post_title'   => (string) $entry['after']['title'],
					'post_content' => wp_slash( (string) $entry['after']['content'] ),
					'post_status'  => (string) $entry['after']['status'],
				)
			);
			$restored++;
		}

		foreach ( $record['options'] as $name => $entry ) {
			if ( ! array_key_exists( 'after', $entry ) ) {
				continue;
			}
			if ( null === $entry['after'] ) {
				delete_option( $name );
			} else {
				update_option( $name, $entry['after'], false );
			}
			$restored++;
		}

		foreach ( $record['themeMods'] as $name => $entry ) {
			if ( ! array_key_exists( 'after', $entry ) ) {
				continue;
			}
			if ( null === $entry['after'] ) {
				remove_theme_mod( $name );
			} else {
				set_theme_mod( $name, $entry['after'] );
			}
			$restored++;
		}

		if ( ! empty( $record['menus'] ) ) {
			$messages[] = __( 'Navigation menus removed by the undo were not recreated. Import the project again to rebuild them.', 'sbs-website-importer' );
		}

		$history[ $at ]['undone'] = false;
		$history[ $at ]['redoneAt'] = current_time( 'mysql', true );
		update_option( self::OPTION, $history, false );

		return array( 'restored' => $restored, 'untrashed' => $untrashed, 'messages' => $messages );
	}

	/** Forgets one recording without changing the site. */
	public static function forget( string $id ): bool {
		$history = self::all();
		$at = self::find( $history, $id );
		if ( null === $at ) {
			return false;
		}
		array_splice( $history, $at, 1 );
		update_option( self::OPTION, $history, false );
		return true;
	}

	/** @param array<int,array<string,mixed>> $history */
	private static function find( array $history, string $id ): ?int {
		foreach ( $history as $index => $record ) {
			if ( (string) ( $record['id'] ?? '' ) === $id ) {
				return (int) $index;
			}
		}
		return null;
	}
}
