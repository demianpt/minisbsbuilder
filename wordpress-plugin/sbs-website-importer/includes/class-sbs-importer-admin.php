<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Admin {
	private string $capability;

	public function __construct() {
		$this->capability = (string) apply_filters( 'sbs_importer_capability', 'edit_theme_options' );
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
		add_action( 'admin_post_sbs_import_stage', array( $this, 'handle_stage' ) );
		add_action( 'admin_post_sbs_import_execute', array( $this, 'handle_execute' ) );
		add_action( 'admin_post_sbs_import_undo', array( $this, 'handle_undo' ) );
		add_action( 'admin_post_sbs_import_redo', array( $this, 'handle_redo' ) );
	}

	public function menu(): void {
		add_menu_page(
			__( 'SBS Website Importer', 'sbs-website-importer' ),
			__( 'SBS Importer', 'sbs-website-importer' ),
			$this->capability,
			'sbs-importer',
			array( $this, 'render' ),
			'dashicons-layout',
			58
		);
	}

	public function assets( string $hook ): void {
		if ( 'toplevel_page_sbs-importer' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'sbs-importer-admin', SBS_IMPORTER_URL . 'assets/admin.css', array(), SBS_IMPORTER_VERSION );
		wp_enqueue_script( 'sbs-importer-admin', SBS_IMPORTER_URL . 'assets/admin.js', array(), SBS_IMPORTER_VERSION, true );
	}

	public function handle_stage(): void {
		$this->authorize( 'sbs_import_stage' );
		$package = SBS_Importer_Package::from_upload( $_FILES['sbs_package'] ?? array() );
		if ( is_wp_error( $package ) ) {
			$this->redirect_error( $package->get_error_message() );
		}
		$token = SBS_Importer_Stage_Store::put( $package );
		if ( is_wp_error( $token ) ) {
			$this->redirect_error( $token->get_error_message() );
		}
		wp_safe_redirect( add_query_arg( array( 'page' => 'sbs-importer', 'stage' => $token ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public function handle_execute(): void {
		$this->authorize( 'sbs_import_execute' );
		$token = sanitize_text_field( wp_unslash( $_POST['stage_token'] ?? '' ) );
		$package = SBS_Importer_Stage_Store::get( $token );
		if ( is_wp_error( $package ) ) {
			$this->redirect_error( $package->get_error_message() );
		}
		$artifacts = isset( $package['artifacts'] ) && is_array( $package['artifacts'] ) ? $package['artifacts'] : array();
		$missing = $this->missing_components( SBS_Importer_Package::collect_components( $artifacts ) );
		if ( $missing && empty( $_POST['allow_missing_blocks'] ) ) {
			$this->redirect_error( __( 'Required Gutenberg blocks are missing. Install or activate the Digital Silk theme/block package, or explicitly allow the compatibility import.', 'sbs-website-importer' ), $token );
		}

		@set_time_limit( 300 );
		/*
		 * Recording starts before the first write and ends after the last, so the
		 * undo has the whole import in one record rather than a page here and a
		 * template part there.
		 */
		SBS_Importer_History::start( sanitize_text_field( wp_unslash( $_POST['page_title'] ?? '' ) ) ?: __( 'SBS project import', 'sbs-website-importer' ) );
		$warnings = (array) ( $package['warnings'] ?? array() );
		if ( ! empty( $_POST['sideload_media'] ) ) {
			$media = new SBS_Importer_Media();
			$warnings = array_merge( $warnings, $media->sideload_artifacts( $artifacts ) );
		}

		$result = array( 'page_id' => 0, 'header_id' => 0, 'footer_id' => 0, 'menu_id' => 0, 'menus' => array(), 'theme' => null, 'warnings' => $warnings, 'missing' => $missing, 'details' => array() );
		$converter = new SBS_Importer_Block_Converter();

		if ( ! empty( $_POST['import_page'] ) && isset( $artifacts['page'] ) ) {
			$converted = $converter->page_to_content( $artifacts['page'] );
			if ( is_wp_error( $converted ) ) {
				$this->redirect_error( $converted->get_error_message(), $token );
			}
			$page_id = SBS_Importer_Services::import_page(
				$artifacts['page'],
				$converted['content'],
				array(
					'page_id'     => absint( $_POST['page_id'] ?? 0 ),
					'page_title'  => sanitize_text_field( wp_unslash( $_POST['page_title'] ?? '' ) ),
					'page_mode'   => sanitize_key( $_POST['page_mode'] ?? 'replace' ),
					'page_status' => sanitize_key( $_POST['page_status'] ?? 'draft' ),
				)
			);
			if ( is_wp_error( $page_id ) ) {
				$this->redirect_error( $page_id->get_error_message(), $token );
			}
			$result['page_id'] = $page_id;
			$result['details']['page'] = $converted;
			$result['warnings'] = array_merge( $result['warnings'], $converted['warnings'] );
		}

		if ( ! empty( $_POST['import_navigation'] ) && isset( $artifacts['navigation'] ) ) {
			$menu_title = sanitize_text_field( wp_unslash( $_POST['menu_title'] ?? __( 'SBS', 'sbs-website-importer' ) ) );
			// Every menu the artifact names, each assigned to the theme location its
			// block expects to read it from. A 2.0 artifact names three: the header
			// menu and the two footer menus.
			$menus = SBS_Importer_Services::create_navigation_menus( $artifacts['navigation'], $menu_title );
			if ( is_wp_error( $menus ) ) {
				$this->redirect_error( $menus->get_error_message(), $token );
			}
			$result['menus'] = $menus;
			$result['menu_id'] = (int) ( $menus['primary-menu'] ?? reset( $menus ) ?: 0 );
			$converted = $converter->navigation_to_content( $artifacts['navigation'], (int) $result['menu_id'] );
			if ( is_wp_error( $converted ) ) {
				$this->redirect_error( $converted->get_error_message(), $token );
			}
			$slug = sanitize_title( wp_unslash( $_POST['header_slug'] ?? 'header' ) ) ?: 'header';
			$title = sanitize_text_field( wp_unslash( $_POST['header_title'] ?? __( 'Header', 'sbs-website-importer' ) ) );
			$id = SBS_Importer_Services::upsert_template_part( $slug, $title, 'header', $converted['content'] );
			if ( is_wp_error( $id ) ) {
				$this->redirect_error( $id->get_error_message(), $token );
			}
			$result['header_id'] = $id;
			$result['header_slug'] = $slug;
			$result['details']['navigation'] = $converted;
			$result['warnings'] = array_merge( $result['warnings'], $converted['warnings'] );

			if ( ! empty( $_POST['set_site_logo'] ) ) {
				$nav_node = $artifacts['navigation']['concept']['global']['navigation'] ?? $artifacts['navigation']['concept']['templateParts']['navigation'] ?? array();
				$logo_url = (string) ( $nav_node['nav']['logo']['url'] ?? '' );
				if ( $logo_url ) {
					$media = isset( $media ) ? $media : new SBS_Importer_Media();
					$logo_id = $media->sideload_logo_url( $logo_url, (string) ( $nav_node['nav']['logo']['text'] ?? '' ) );
					if ( is_wp_error( $logo_id ) ) {
						$result['warnings'][] = $logo_id->get_error_message();
					} elseif ( $logo_id ) {
						SBS_Importer_History::replacing_option( 'site_logo' );
						update_option( 'site_logo', (int) $logo_id );
					}
				} elseif ( ! get_option( 'site_logo' ) ) {
					$result['warnings'][] = __( 'The navigation export contains a text identity but no logo image URL. Set the WordPress Site Logo before publishing the Header.', 'sbs-website-importer' );
				}
			}
		}

		if ( ! empty( $_POST['import_footer'] ) && isset( $artifacts['footer'] ) ) {
			$converted = $converter->footer_to_content( $artifacts['footer'] );
			if ( is_wp_error( $converted ) ) {
				$this->redirect_error( $converted->get_error_message(), $token );
			}
			$slug = sanitize_title( wp_unslash( $_POST['footer_slug'] ?? 'footer' ) ) ?: 'footer';
			$title = sanitize_text_field( wp_unslash( $_POST['footer_title'] ?? __( 'Footer', 'sbs-website-importer' ) ) );
			$id = SBS_Importer_Services::upsert_template_part( $slug, $title, 'footer', $converted['content'] );
			if ( is_wp_error( $id ) ) {
				$this->redirect_error( $id->get_error_message(), $token );
			}
			$result['footer_id'] = $id;
			$result['footer_slug'] = $slug;
			$result['details']['footer'] = $converted;
			$result['warnings'] = array_merge( $result['warnings'], $converted['warnings'] );
		}

		if ( ! empty( $_POST['apply_theme'] ) ) {
			$theme = SBS_Importer_Services::artifact_theme( $artifacts );
			if ( $theme ) {
				$result['theme'] = SBS_Importer_Theme::save( $theme );
			}
		}
		$result['warnings'] = array_values( array_unique( array_filter( $result['warnings'] ) ) );
		$result['history_id'] = SBS_Importer_History::finish(
			array(
				'page'   => (string) ( $result['page_id'] ?? 0 ),
				'header' => (string) ( $result['header_id'] ?? 0 ),
				'footer' => (string) ( $result['footer_id'] ?? 0 ),
			)
		);
		SBS_Importer_Stage_Store::delete( $token );
		$result_token = wp_generate_uuid4();
		set_transient( 'sbs_import_result_' . get_current_user_id() . '_' . $result_token, $result, 15 * MINUTE_IN_SECONDS );
		wp_safe_redirect( add_query_arg( array( 'page' => 'sbs-importer', 'result' => $result_token ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/** Puts the site back to how it was before one import. */
	public function handle_undo(): void {
		$this->authorize( 'sbs_import_undo' );
		$id = sanitize_text_field( wp_unslash( $_POST['history_id'] ?? '' ) );
		$outcome = SBS_Importer_History::undo( $id );
		if ( is_wp_error( $outcome ) ) {
			$this->redirect_error( $outcome->get_error_message() );
		}
		$notice = sprintf(
			/* translators: 1: number of restored items, 2: number of trashed posts. */
			__( 'Import undone: %1$d settings and pages restored, %2$d imported posts moved to the trash.', 'sbs-website-importer' ),
			(int) $outcome['restored'],
			(int) $outcome['trashed']
		);
		foreach ( (array) $outcome['messages'] as $message ) {
			$notice .= ' ' . $message;
		}
		$this->redirect_notice( $notice );
	}

	/** Re-applies an import that was undone. */
	public function handle_redo(): void {
		$this->authorize( 'sbs_import_redo' );
		$id = sanitize_text_field( wp_unslash( $_POST['history_id'] ?? '' ) );
		$outcome = SBS_Importer_History::redo( $id );
		if ( is_wp_error( $outcome ) ) {
			$this->redirect_error( $outcome->get_error_message() );
		}
		$notice = sprintf(
			/* translators: 1: number of restored items, 2: number of untrashed posts. */
			__( 'Import re-applied: %1$d settings and pages rewritten, %2$d posts restored from the trash.', 'sbs-website-importer' ),
			(int) $outcome['restored'],
			(int) $outcome['untrashed']
		);
		foreach ( (array) $outcome['messages'] as $message ) {
			$notice .= ' ' . $message;
		}
		$this->redirect_notice( $notice );
	}

	private function redirect_notice( string $message ): void {
		set_transient( 'sbs_import_notice_' . get_current_user_id(), $message, 5 * MINUTE_IN_SECONDS );
		wp_safe_redirect( add_query_arg( array( 'page' => 'sbs-importer' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/** The import history, with a way back from each entry. */
	private function render_history(): void {
		$history = SBS_Importer_History::all();
		if ( empty( $history ) ) {
			return;
		}
		?>
		<div class="sbs-history">
			<h2><?php esc_html_e( 'Import history', 'sbs-website-importer' ); ?></h2>
			<p class="sbs-history__intro"><?php esc_html_e( 'Undo puts the site back to how it was before that import: pages and template parts it overwrote are restored, and anything it created goes to the trash. Re-apply reverses the undo.', 'sbs-website-importer' ); ?></p>
			<table class="widefat sbs-history__table">
				<thead><tr>
					<th><?php esc_html_e( 'When', 'sbs-website-importer' ); ?></th>
					<th><?php esc_html_e( 'Import', 'sbs-website-importer' ); ?></th>
					<th><?php esc_html_e( 'Touched', 'sbs-website-importer' ); ?></th>
					<th><?php esc_html_e( 'State', 'sbs-website-importer' ); ?></th>
					<th></th>
				</tr></thead>
				<tbody>
				<?php foreach ( $history as $record ) :
					$created = count( (array) ( $record['created'] ?? array() ) );
					$replaced = count( (array) ( $record['replaced'] ?? array() ) );
					$undone = ! empty( $record['undone'] );
					?>
					<tr>
						<td><?php echo esc_html( (string) ( $record['when'] ?? '' ) ); ?></td>
						<td><?php echo esc_html( (string) ( $record['label'] ?? '' ) ); ?></td>
						<td><?php
							/* translators: 1: created count, 2: overwritten count. */
							echo esc_html( sprintf( __( '%1$d created, %2$d overwritten', 'sbs-website-importer' ), $created, $replaced ) );
						?></td>
						<td><?php echo $undone ? esc_html__( 'Undone', 'sbs-website-importer' ) : esc_html__( 'Applied', 'sbs-website-importer' ); ?></td>
						<td>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
								<?php wp_nonce_field( $undone ? 'sbs_import_redo' : 'sbs_import_undo' ); ?>
								<input type="hidden" name="action" value="<?php echo esc_attr( $undone ? 'sbs_import_redo' : 'sbs_import_undo' ); ?>">
								<input type="hidden" name="history_id" value="<?php echo esc_attr( (string) ( $record['id'] ?? '' ) ); ?>">
								<button type="submit" class="button"><?php
									echo $undone ? esc_html__( 'Re-apply', 'sbs-website-importer' ) : esc_html__( 'Undo this import', 'sbs-website-importer' );
								?></button>
							</form>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php
	}

	public function render(): void {
		if ( ! current_user_can( $this->capability ) ) {
			wp_die( esc_html__( 'You do not have permission to import SBS projects.', 'sbs-website-importer' ) );
		}
		$stage_token = sanitize_text_field( wp_unslash( $_GET['stage'] ?? '' ) );
		$result_token = sanitize_text_field( wp_unslash( $_GET['result'] ?? '' ) );
		?>
		<div class="wrap sbs-importer-wrap">
			<div class="sbs-importer-header">
				<div><span class="sbs-kicker"><?php esc_html_e( 'Digital Silk · DST workflow', 'sbs-website-importer' ); ?></span><h1><?php esc_html_e( 'SBS Website Importer', 'sbs-website-importer' ); ?></h1><p><?php esc_html_e( 'Turn an SBS project bundle into native, editable WordPress pages and global Header/Footer template parts.', 'sbs-website-importer' ); ?></p></div>
				<span class="sbs-version">v<?php echo esc_html( SBS_IMPORTER_VERSION ); ?></span>
			</div>
			<?php
			if ( isset( $_GET['sbs_error'] ) ) {
				echo '<div class="notice notice-error"><p>' . esc_html( wp_unslash( $_GET['sbs_error'] ) ) . '</p></div>';
			}
			$notice = get_transient( 'sbs_import_notice_' . get_current_user_id() );
			if ( $notice ) {
				delete_transient( 'sbs_import_notice_' . get_current_user_id() );
				echo '<div class="notice notice-success"><p>' . esc_html( (string) $notice ) . '</p></div>';
			}
			if ( $result_token ) {
				$this->render_result( $result_token );
			} elseif ( $stage_token ) {
				$this->render_review( $stage_token );
			} else {
				$this->render_upload();
			}
			// Always reachable: a mistaken import has to be undoable from the
			// landing screen, not only from the screen that reported it.
			$this->render_history();
			?>
		</div>
		<?php
	}

	private function render_upload(): void {
		?>
		<div class="sbs-step"><span>1</span><div><b><?php esc_html_e( 'Upload the builder export', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Use the complete project ZIP, or import page/navigation/footer JSON individually.', 'sbs-website-importer' ); ?></small></div></div>
		<div class="sbs-panel">
			<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post" enctype="multipart/form-data">
				<input type="hidden" name="action" value="sbs_import_stage">
				<?php wp_nonce_field( 'sbs_import_stage' ); ?>
				<label class="sbs-dropzone" for="sbs-package">
					<span class="dashicons dashicons-upload"></span>
					<strong><?php esc_html_e( 'Drop a complete project ZIP here', 'sbs-website-importer' ); ?></strong>
					<span><?php esc_html_e( 'or choose navigation.json, footer.json, page.json, or complete-project.json', 'sbs-website-importer' ); ?></span>
					<input id="sbs-package" type="file" name="sbs_package" accept=".zip,.json,application/zip,application/json" required>
					<em id="sbs-file-name"><?php esc_html_e( 'No file selected', 'sbs-website-importer' ); ?></em>
				</label>
				<div class="sbs-actions"><button class="button button-primary button-hero"><?php esc_html_e( 'Review project', 'sbs-website-importer' ); ?></button></div>
			</form>
		</div>
		<div class="sbs-info-grid">
			<div><span class="dashicons dashicons-editor-table"></span><b><?php esc_html_e( 'Native DST blocks', 'sbs-website-importer' ); ?></b><p><?php esc_html_e( 'Block names and registered attributes are preserved, so the Digital Silk inspector controls remain editable.', 'sbs-website-importer' ); ?></p></div>
			<div><span class="dashicons dashicons-admin-site-alt3"></span><b><?php esc_html_e( 'Global template parts', 'sbs-website-importer' ); ?></b><p><?php esc_html_e( 'Header and Footer imports appear in Appearance → Editor → Patterns under their respective areas.', 'sbs-website-importer' ); ?></p></div>
			<div><span class="dashicons dashicons-shield"></span><b><?php esc_html_e( 'Validated import', 'sbs-website-importer' ); ?></b><p><?php esc_html_e( 'The importer checks the package, required blocks, archive paths, file sizes, and CSS values before writing content.', 'sbs-website-importer' ); ?></p></div>
		</div>
		<?php
	}

	private function render_review( string $token ): void {
		$package = SBS_Importer_Stage_Store::get( $token );
		if ( is_wp_error( $package ) ) {
			echo '<div class="notice notice-error"><p>' . esc_html( $package->get_error_message() ) . '</p></div>';
			$this->render_upload();
			return;
		}
		$artifacts = $package['artifacts'] ?? array();
		$components = SBS_Importer_Package::collect_components( $artifacts );
		$missing = $this->missing_components( $components );
		$page = $artifacts['page']['concept']['page'] ?? array();
		$nav = $artifacts['navigation']['concept']['global']['navigation'] ?? $artifacts['navigation']['concept']['templateParts']['navigation'] ?? array();
		$footer = $artifacts['footer']['concept']['global']['footer'] ?? $artifacts['footer']['concept']['templateParts']['footer'] ?? array();
		?>
		<div class="sbs-step"><span>2</span><div><b><?php esc_html_e( 'Review and choose destinations', 'sbs-website-importer' ); ?></b><small><?php echo esc_html( $package['source_name'] ?? '' ); ?></small></div></div>
		<div class="sbs-artifact-grid">
			<?php if ( isset( $artifacts['page'] ) ) : ?><div class="sbs-artifact"><span class="dashicons dashicons-media-document"></span><div><b><?php esc_html_e( 'Page', 'sbs-website-importer' ); ?></b><strong><?php echo esc_html( $page['title'] ?? __( 'Untitled page', 'sbs-website-importer' ) ); ?></strong><small><?php echo esc_html( count( $page['sections'] ?? array() ) . ' modules' ); ?></small></div></div><?php endif; ?>
			<?php if ( isset( $artifacts['navigation'] ) ) : ?><div class="sbs-artifact"><span class="dashicons dashicons-menu"></span><div><b><?php esc_html_e( 'Navigation', 'sbs-website-importer' ); ?></b><strong><?php esc_html_e( 'Header template part', 'sbs-website-importer' ); ?></strong><small><?php echo esc_html( count( $nav['nav']['menu'] ?? array() ) . ' menu items' ); ?></small></div></div><?php endif; ?>
			<?php if ( isset( $artifacts['footer'] ) ) : ?><div class="sbs-artifact"><span class="dashicons dashicons-align-full-width"></span><div><b><?php esc_html_e( 'Footer', 'sbs-website-importer' ); ?></b><strong><?php esc_html_e( 'Footer template part', 'sbs-website-importer' ); ?></strong><small><?php echo esc_html( count( $footer['footer']['columns'] ?? array() ) . ' columns' ); ?></small></div></div><?php endif; ?>
		</div>
		<?php foreach ( (array) ( $package['warnings'] ?? array() ) as $warning ) : ?><div class="notice notice-warning inline"><p><?php echo esc_html( $warning ); ?></p></div><?php endforeach; ?>
		<?php if ( ! wp_is_block_theme() && ( isset( $artifacts['navigation'] ) || isset( $artifacts['footer'] ) ) ) : ?><div class="notice notice-warning inline"><p><?php esc_html_e( 'The active theme is not a block theme. Header and Footer template parts will be created, but the current theme may not use them on the front end.', 'sbs-website-importer' ); ?></p></div><?php endif; ?>
		<?php if ( $missing ) : ?><div class="notice notice-error inline"><p><strong><?php esc_html_e( 'Missing registered blocks:', 'sbs-website-importer' ); ?></strong> <?php echo esc_html( implode( ', ', $missing ) ); ?></p></div><?php endif; ?>

		<form class="sbs-panel sbs-review-form" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
			<input type="hidden" name="action" value="sbs_import_execute"><input type="hidden" name="stage_token" value="<?php echo esc_attr( $token ); ?>">
			<?php wp_nonce_field( 'sbs_import_execute' ); ?>
			<?php if ( isset( $artifacts['page'] ) ) : $this->render_page_options( $page ); endif; ?>
			<?php if ( isset( $artifacts['navigation'] ) ) : $this->render_navigation_options( $nav ); endif; ?>
			<?php if ( isset( $artifacts['footer'] ) ) : $this->render_footer_options(); endif; ?>
			<div class="sbs-options-section"><h2><?php esc_html_e( 'Shared import options', 'sbs-website-importer' ); ?></h2><label class="sbs-check"><input type="checkbox" name="apply_theme" value="1" checked><span><b><?php esc_html_e( 'Apply exported design tokens', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Loads the exported DST colors, typography, containers, spacing, and button variables in the front end and block editor.', 'sbs-website-importer' ); ?></small></span></label><label class="sbs-check"><input type="checkbox" name="sideload_media" value="1" checked><span><b><?php esc_html_e( 'Copy external media into WordPress', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Downloads supported image assets, deduplicates by source URL, and rewrites block media references.', 'sbs-website-importer' ); ?></small></span></label><?php if ( $missing ) : ?><label class="sbs-check sbs-check-warning"><input type="checkbox" name="allow_missing_blocks" value="1"><span><b><?php esc_html_e( 'Import despite missing blocks', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Use only for troubleshooting. Missing Digital Silk blocks will not expose their inspector options until registered.', 'sbs-website-importer' ); ?></small></span></label><?php endif; ?></div>
			<div class="sbs-actions"><a class="button button-large" href="<?php echo esc_url( admin_url( 'admin.php?page=sbs-importer' ) ); ?>"><?php esc_html_e( 'Start over', 'sbs-website-importer' ); ?></a><button class="button button-primary button-hero"><?php esc_html_e( 'Import project', 'sbs-website-importer' ); ?></button></div>
		</form>
		<?php
	}

	private function render_page_options( array $page ): void {
		$pages = get_pages( array( 'sort_column' => 'post_title', 'post_status' => array( 'publish', 'draft', 'private' ) ) );
		?>
		<div class="sbs-options-section"><h2><label><input type="checkbox" name="import_page" value="1" checked> <?php esc_html_e( 'Import page modules', 'sbs-website-importer' ); ?></label></h2><div class="sbs-field-grid"><label><span><?php esc_html_e( 'Page title', 'sbs-website-importer' ); ?></span><input type="text" name="page_title" value="<?php echo esc_attr( $page['title'] ?? '' ); ?>"></label><label><span><?php esc_html_e( 'Destination', 'sbs-website-importer' ); ?></span><select name="page_id"><option value="0"><?php esc_html_e( 'Create a new page', 'sbs-website-importer' ); ?></option><?php foreach ( $pages as $existing ) : ?><option value="<?php echo esc_attr( $existing->ID ); ?>"><?php echo esc_html( $existing->post_title . ' (#' . $existing->ID . ')' ); ?></option><?php endforeach; ?></select></label><label><span><?php esc_html_e( 'Existing-page behavior', 'sbs-website-importer' ); ?></span><select name="page_mode"><option value="replace"><?php esc_html_e( 'Replace existing content', 'sbs-website-importer' ); ?></option><option value="append"><?php esc_html_e( 'Append after existing content', 'sbs-website-importer' ); ?></option></select></label><label><span><?php esc_html_e( 'New page status', 'sbs-website-importer' ); ?></span><select name="page_status"><option value="draft"><?php esc_html_e( 'Draft', 'sbs-website-importer' ); ?></option><option value="publish"><?php esc_html_e( 'Published', 'sbs-website-importer' ); ?></option><option value="private"><?php esc_html_e( 'Private', 'sbs-website-importer' ); ?></option></select></label></div></div>
		<?php
	}

	private function render_navigation_options( array $nav ): void {
		$brand = $nav['nav']['logo']['text'] ?? get_bloginfo( 'name' );
		?>
		<div class="sbs-options-section"><h2><label><input type="checkbox" name="import_navigation" value="1" checked> <?php esc_html_e( 'Import Navigation as Header template part', 'sbs-website-importer' ); ?></label></h2><div class="sbs-field-grid"><label><span><?php esc_html_e( 'Header title', 'sbs-website-importer' ); ?></span><input type="text" name="header_title" value="<?php esc_attr_e( 'Header', 'sbs-website-importer' ); ?>"></label><label><span><?php esc_html_e( 'Header slug', 'sbs-website-importer' ); ?></span><input type="text" name="header_slug" value="header"><small><?php esc_html_e( 'Using “header” updates the standard template part referenced by most block themes.', 'sbs-website-importer' ); ?></small></label><label><span><?php esc_html_e( 'WordPress menu name', 'sbs-website-importer' ); ?></span><input type="text" name="menu_title" value="<?php echo esc_attr( $brand . ' Primary Navigation' ); ?>"></label><label class="sbs-inline-check"><input type="checkbox" name="set_site_logo" value="1" checked> <span><?php esc_html_e( 'Use the exported logo as the WordPress Site Logo when a logo URL exists', 'sbs-website-importer' ); ?></span></label></div></div>
		<?php
	}

	private function render_footer_options(): void {
		?>
		<div class="sbs-options-section"><h2><label><input type="checkbox" name="import_footer" value="1" checked> <?php esc_html_e( 'Import Footer template part', 'sbs-website-importer' ); ?></label></h2><div class="sbs-field-grid"><label><span><?php esc_html_e( 'Footer title', 'sbs-website-importer' ); ?></span><input type="text" name="footer_title" value="<?php esc_attr_e( 'Footer', 'sbs-website-importer' ); ?>"></label><label><span><?php esc_html_e( 'Footer slug', 'sbs-website-importer' ); ?></span><input type="text" name="footer_slug" value="footer"><small><?php esc_html_e( 'Using “footer” updates the standard template part referenced by most block themes.', 'sbs-website-importer' ); ?></small></label></div></div>
		<?php
	}

	private function render_result( string $token ): void {
		$key = 'sbs_import_result_' . get_current_user_id() . '_' . $token;
		$result = get_transient( $key );
		delete_transient( $key );
		if ( ! is_array( $result ) ) {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'The import result has expired.', 'sbs-website-importer' ) . '</p></div>';
			$this->render_upload();
			return;
		}
		?>
		<div class="sbs-success"><span class="dashicons dashicons-yes-alt"></span><div><h2><?php esc_html_e( 'Project imported', 'sbs-website-importer' ); ?></h2><p><?php esc_html_e( 'The imported content is stored as native Gutenberg blocks and template parts.', 'sbs-website-importer' ); ?></p></div></div>
		<div class="sbs-result-grid">
			<?php if ( $result['page_id'] ) : ?><a href="<?php echo esc_url( get_edit_post_link( $result['page_id'], 'raw' ) ); ?>"><span class="dashicons dashicons-edit-page"></span><b><?php esc_html_e( 'Edit imported page', 'sbs-website-importer' ); ?></b><small><?php echo esc_html( ( $result['details']['page']['blocks'] ?? 0 ) . ' blocks imported' ); ?></small></a><?php endif; ?>
			<?php if ( $result['header_id'] ) : ?><a href="<?php echo esc_url( SBS_Importer_Services::template_part_editor_url( $result['header_slug'] ) ); ?>"><span class="dashicons dashicons-menu"></span><b><?php esc_html_e( 'Edit Header', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Appearance → Editor → Patterns → Header', 'sbs-website-importer' ); ?></small></a><?php endif; ?>
			<?php if ( $result['footer_id'] ) : ?><a href="<?php echo esc_url( SBS_Importer_Services::template_part_editor_url( $result['footer_slug'] ) ); ?>"><span class="dashicons dashicons-align-full-width"></span><b><?php esc_html_e( 'Edit Footer', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Appearance → Editor → Patterns → Footer', 'sbs-website-importer' ); ?></small></a><?php endif; ?>
			<a href="<?php echo esc_url( home_url( '/' ) ); ?>" target="_blank" rel="noopener"><span class="dashicons dashicons-external"></span><b><?php esc_html_e( 'View site', 'sbs-website-importer' ); ?></b><small><?php esc_html_e( 'Open the front end in a new tab', 'sbs-website-importer' ); ?></small></a>
		</div>
		<?php if ( $result['theme'] ) : ?><div class="notice notice-success inline"><p><?php echo esc_html( sprintf( __( 'Applied %1$d validated DST CSS variables (%2$d bytes).', 'sbs-website-importer' ), $result['theme']['variables'], $result['theme']['css_bytes'] ) ); ?></p></div><?php endif; ?>
		<?php foreach ( (array) $result['warnings'] as $warning ) : ?><div class="notice notice-warning inline"><p><?php echo esc_html( $warning ); ?></p></div><?php endforeach; ?>
		<div class="sbs-actions"><a class="button button-primary button-hero" href="<?php echo esc_url( admin_url( 'admin.php?page=sbs-importer' ) ); ?>"><?php esc_html_e( 'Import another project', 'sbs-website-importer' ); ?></a></div>
		<?php
	}

	/** @param string[] $components @return string[] */
	private function missing_components( array $components ): array {
		if ( ! class_exists( 'WP_Block_Type_Registry' ) ) {
			return array();
		}
		$registry = WP_Block_Type_Registry::get_instance();
		$missing = array();
		foreach ( $components as $component ) {
			if ( 'gravityforms/form' === $component && ! $registry->is_registered( $component ) ) {
				$missing[] = $component;
			} elseif ( str_starts_with( $component, 'ds-blocks/' ) && ! $registry->is_registered( $component ) ) {
				$missing[] = $component;
			}
		}
		return array_values( array_unique( $missing ) );
	}

	private function authorize( string $action ): void {
		if ( ! current_user_can( $this->capability ) ) {
			wp_die( esc_html__( 'You do not have permission to import SBS projects.', 'sbs-website-importer' ) );
		}
		check_admin_referer( $action );
	}

	private function redirect_error( string $message, string $stage = '' ): void {
		$args = array( 'page' => 'sbs-importer', 'sbs_error' => $message );
		if ( $stage ) {
			$args['stage'] = $stage;
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}
}
