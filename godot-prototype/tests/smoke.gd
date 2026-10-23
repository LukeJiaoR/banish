extends SceneTree

const Iso = preload("res://scripts/iso.gd")
var checks := 0
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("run")

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

func run() -> void:
	var scene = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	# Deterministic simulation steps below, not real-time scheduling assertions.
	scene.set_process(false)
	scene.terrain.set_process(false)
	for animal in scene.animals:
		animal.set_process(false)
	check(scene.animals.size() == 7, "7 animals spawned")
	check(scene.occupied.size() >= 75, "dense A-study buildings and canopy reserve footprints")
	check(scene.terrain.show_behind_parent and scene.entities.show_behind_parent, "placement overlay renders above terrain and actors")
	for x in range(-2, 26):
		for y in range(-2, 26):
			var point := Vector2(x + 0.5, y + 0.5)
			check(Iso.unproject(Iso.project(point)).is_equal_approx(point), "isometric round trip")
	check(Iso.cell_at(Vector2(-1, -1)) == Vector2i(-1, -1), "negative cells floor rather than truncate")
	for animal in scene.animals:
		var sprites: SpriteFrames = animal.sprite.sprite_frames
		for pose in ["idle", "graze", "turn", "walk"]:
			check(sprites.get_frame_count(pose) == (4 if pose == "walk" else 1), animal.species + " complete pose " + pose)
			for frame in range(sprites.get_frame_count(pose)):
				check(sprites.get_frame_texture(pose, frame) != null, "loaded pose texture")
		check(animal.sprite.offset == Vector2(-64, -126), "animal shared source-space foot anchor")
		var original: Dictionary = animal.snapshot()
		var poses := {}
		var gait := {}
		for step in range(600):
			animal.advance(0.04)
			poses[animal.phase] = true
			if animal.phase == "walk":
				gait[animal.sprite.frame] = true
			var cell := Vector2i(animal.tile_position.floor())
			check(scene.reserved.has(cell) and not scene.occupied.has(cell) and not Iso.is_water(cell), "animal remains in clear reserved habitat")
		check(poses.size() == 4, "walk/graze/turn/idle all reached")
		check(gait.size() == 4, "all 4 actual gait textures advanced")
		check(animal.distance_walked > original.distance + 1, "actor genuinely changes position")
	scene.set_paused(true)
	for animal in scene.animals:
		var frozen: Dictionary = animal.snapshot()
		animal.advance(8.0)
		check(animal.snapshot() == frozen, "pause freezes actor position, gait and pose")
	check(not scene.terrain.animate, "pause freezes river motion")
	scene.set_paused(false)
	check(scene.animals.all(func(a): return a.active), "resume reactivates all actors")
	# Public placement contract: staged first, no side effect until confirm.
	scene.select_tool("house")
	var occupied_before: int = scene.occupied.size()
	check(scene.stage_placement(Vector2i(10, 13)), "empty 2x2 house footprint stages")
	check(scene.occupied.size() == occupied_before and scene.placed.is_empty(), "preview does not mutate the world")
	check(not scene.confirm_button.disabled, "valid preview enables confirm")
	check(scene.confirm_placement(), "confirm places house")
	check(scene.occupied.size() == occupied_before + 4 and scene.placed.size() == 1, "one confirm claims exactly four cells")
	check(not scene.confirm_placement() and scene.placed.size() == 1, "repeat confirmation cannot duplicate")
	for blocked in [Vector2i(10, 13), Vector2i(18, 5), Vector2i(17, 5), Vector2i(23, 23), Vector2i(-1, 2), Vector2i(13, 8), Vector2i(8, 2)]:
		check(not scene.stage_placement(blocked), "blocked footprint rejected at " + str(blocked))
		check(scene.confirm_button.disabled and not scene.confirm_placement(), "blocked confirm cannot mutate")
	scene.undo_placement()
	check(scene.occupied.size() == occupied_before and scene.placed.is_empty(), "undo restores occupancy")
	scene.undo_placement()
	check(scene.occupied.size() == occupied_before, "empty undo preserves seed objects")
	for kind in ["tree", "road"]:
		scene.select_tool(kind)
		check(scene.stage_placement(Vector2i(10, 13)) and scene.confirm_placement(), kind + " places")
		check(not scene.placement_error("house", Vector2i(10, 13)).is_empty(), kind + " blocks overlapping house")
		scene.undo_placement()
		check(scene.placement_error(kind, Vector2i(10, 13)).is_empty(), kind + " undo releases footprint")
	scene.select_tool("house")
	scene.stage_placement(Vector2i(10, 13))
	scene.select_tool("tree")
	check(not scene.confirm_placement(), "changing tool clears stale intent")
	scene.stage_placement(Vector2i(10, 13))
	scene.select_tool("")
	check(not scene.confirm_placement(), "cancel clears stale intent")
	# Camera limits, pointer anchoring and drag release across UI.
	scene.camera.position = Vector2(0, 365)
	scene.camera.zoom = Vector2.ONE
	scene.camera.force_update_scroll()
	var mouse_before: Vector2 = scene.get_global_mouse_position()
	scene.zoom_by(1.2)
	check(scene.get_global_mouse_position().distance_to(mouse_before) < 0.1, "wheel zoom preserves pointer world point")
	scene.zoom_by(100)
	check(is_equal_approx(scene.camera.zoom.x, 2.4), "maximum zoom bounded")
	scene.zoom_by(0.001)
	check(is_equal_approx(scene.camera.zoom.x, 0.65), "minimum zoom bounded")
	scene.camera.position = Vector2(99999, -99999)
	scene._clamp_camera()
	check(scene.camera.position == Vector2(680, 0), "camera position bounded")
	scene.dragging = true
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_MIDDLE
	release.pressed = false
	scene._input(release)
	check(not scene.dragging, "middle release ends drag even over UI")
	scene.dragging = true
	scene._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	check(not scene.dragging, "focus loss ends drag")
	# Buttons are connected to the same live state methods.
	scene.tool_buttons["house"].pressed.emit()
	check(scene.tool == "house", "house button invokes correct tool, not captured final loop variable")
	scene.tool_buttons["tree"].pressed.emit()
	check(scene.tool == "tree", "tree button invokes correct tool")
	scene.pause_button.pressed.emit()
	check(scene.paused, "pause UI invokes pause")
	# Dispatch through the actual viewport (not direct handler calls) to prove
	# Control consumption prevents a header click from becoming a map click.
	scene.select_tool("tree")
	var pending_before: Vector2i = scene.pending
	var mouse := InputEventMouseButton.new()
	mouse.button_index = MOUSE_BUTTON_LEFT
	mouse.pressed = true
	mouse.position = Vector2(60, 50)
	root.push_input(mouse)
	await process_frame
	check(scene.pending == pending_before and scene.placed.is_empty(), "UI panel consumes click without map placement")
	mouse.pressed = false
	root.push_input(mouse)
	# UI dimensions are computed by Godot, not a raster visual assertion.
	for viewport_size in [Vector2i(1280, 800), Vector2i(960, 640)]:
		root.size = viewport_size
		await process_frame
		await process_frame
		for panel in scene.ui.get_children():
			if panel is Control:
				var rect: Rect2 = panel.get_global_rect()
				check(rect.position.x >= 0 and rect.position.y >= 0 and rect.end.x <= root.get_visible_rect().size.x + 1 and rect.end.y <= root.get_visible_rect().size.y + 1, "UI panel stays inside viewport at " + str(viewport_size))
	scene.reset_scene()
	await process_frame
	check(scene.animals.size() == 7 and scene.placed.is_empty() and not scene.paused and scene.tool.is_empty(), "reset restores isolated initial trial")
	check(scene.occupied.size() == occupied_before, "reset neither duplicates nor loses seed objects")
	check(ProjectSettings.get_setting("application/config/custom_user_dir_name") == "banish-godot-prototype", "separate app namespace")
	check(ProjectSettings.get_setting("rendering/renderer/rendering_method") == "gl_compatibility", "web-capable compatibility renderer")
	for was_paused in [false, true]:
		scene.set_paused(was_paused)
		scene.toggle_reference()
		check(scene.reference_visible and scene.reference_layer.visible and scene.paused, "reference view is explicit and pauses the scene")
		var key := InputEventKey.new()
		key.physical_keycode = KEY_1
		key.pressed = true
		scene._unhandled_input(key)
		check(scene.tool.is_empty(), "reference view blocks hidden map keyboard actions")
		key.physical_keycode = KEY_ESCAPE
		scene._unhandled_input(key)
		check(not scene.reference_visible and scene.paused == was_paused, "closing reference restores previous pause state")
	scene.select_tool("house")
	scene.stage_placement(Vector2i(10, 13))
	scene.terrain.show_grid = true
	scene.toggle_presentation()
	check(not scene.ui.visible and scene.presentation, "presentation hides interface")
	check(scene.tool.is_empty() and not scene.confirm_placement() and not scene.terrain.show_grid, "presentation clears building preview and hides grid")
	var hidden_key := InputEventKey.new()
	hidden_key.physical_keycode = KEY_1
	hidden_key.pressed = true
	scene._unhandled_input(hidden_key)
	check(scene.tool.is_empty(), "presentation blocks hidden construction shortcuts")
	scene.toggle_presentation()
	check(scene.ui.visible and not scene.presentation, "presentation can restore interface")
	check(scene.terrain.show_grid, "presentation restores previous grid preference")
	check(scene.shadows.get_child_count() > 40, "A-study has a separate ground-shadow layer")
	check(scene.terrain.courtyards.size() == 9, "A-study has nine coordinated village aprons")
	print(JSON.stringify({"checks": checks, "failures": failures, "engine": Engine.get_version_info().string, "scope": "Headless Godot engine integration; not GPU screenshot, browser or physical device validation"}))
	quit(0 if failures.is_empty() else 1)
