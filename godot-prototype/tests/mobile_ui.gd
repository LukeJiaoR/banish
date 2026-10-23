extends SceneTree
const UI = preload("res://scripts/trial_ui.gd")
var errors: Array[String] = []
var checks := 0
func check(ok: bool, text: String) -> void:
	checks += 1
	if not ok:
		errors.append(text)
		push_error(text)
func _initialize() -> void:
	call_deferred("run")
func run() -> void:
	root.min_size = Vector2i(240, 240)
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	var nodes: Dictionary = main.get_meta("trial_layout_nodes")
	for size in [Vector2i(390,844), Vector2i(320,640), Vector2i(844,390)]:
		root.size = size
		root.content_scale_size = size
		await process_frame
		main.compact_ui = true
		UI.layout(main)
		await process_frame
		await process_frame
		check(not nodes.side.visible, "build starts collapsed " + str(size))
		check(nodes.recovery.is_visible_in_tree(), "touch recovery visible " + str(size))
		nodes.build_toggle.pressed.emit()
		UI.layout(main)
		await process_frame
		await process_frame
		check(nodes.side.visible, "build opens " + str(size))
		for node in [nodes.header, nodes.side, nodes.recovery, main.confirm_button, nodes.undo]:
			var r: Rect2 = node.get_global_rect()
			check(r.position.x >= -1 and r.position.y >= -1 and r.end.x <= size.x+1 and r.end.y <= size.y+1, "control fits " + node.name + " " + str(size) + " rect " + str(r))
		for key in main.tool_buttons:
			var r: Rect2 = main.tool_buttons[key].get_global_rect()
			check(r.size.y >= 44 and r.size.x >= 44, "touch card target " + key)
		main.tool_buttons.house.pressed.emit()
		check(main.tool == "house", "live house callback")
		nodes.restore.pressed.emit()
		await process_frame
		check(main.presentation and not main.ui.visible and nodes.recovery.is_visible_in_tree(), "pure scene recovery accessible")
		nodes.restore.pressed.emit()
		await process_frame
		check(not main.presentation and main.ui.visible, "touch restores UI")
		check(not nodes.side.visible, "restored UI does not cover map with build")
		print("MOBILE_LAYOUT ", size, " ", nodes.header.get_global_rect(), " ", nodes.side.get_global_rect(), " ", nodes.recovery.get_global_rect())
	main.compact_ui = false
	root.size = Vector2i(1280,800)
	root.content_scale_size = Vector2i(1280,800)
	await process_frame
	UI.layout(main)
	await process_frame
	check(nodes.side.visible and not nodes.recovery.visible, "desktop restored")
	print(JSON.stringify({"checks":checks,"failures":errors}))
	quit(0 if errors.is_empty() else 1)
