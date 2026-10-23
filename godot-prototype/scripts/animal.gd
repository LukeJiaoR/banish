class_name TrialAnimal
extends Node2D

const Iso = preload("res://scripts/iso.gd")
var species := "deer"
var route: Array[Vector2] = []
var route_index := 1
var tile_position := Vector2.ZERO
var elapsed := 0.0
var distance_walked := 0.0
var active := true
var sprite: AnimatedSprite2D
var phase := "idle"
var phase_offset := 0.0
var facing_right := false

func setup(kind: String, points: Array[Vector2], offset: float) -> void:
	species = kind
	route = points
	tile_position = route[0]
	phase_offset = offset
	position = Iso.project(tile_position)
	sprite = AnimatedSprite2D.new()
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for pose in ["idle", "graze", "turn", "walk"]:
		frames.add_animation(pose)
		frames.set_animation_speed(pose, 7.0)
		var count := 4 if pose == "walk" else 1
		for i in range(count):
			var suffix: String = pose + "_" + str(i) if pose == "walk" else pose
			frames.add_frame(pose, load("res://assets/props/" + species + "_" + suffix + ".png"))
	sprite.sprite_frames = frames
	sprite.centered = false
	sprite.offset = Vector2(-64, -126)
	var widths := {"deer": 40.0, "sheep": 38.0, "cattle": 48.0, "chicken": 25.0}
	sprite.scale = Vector2.ONE * widths[species] / 128.0
	sprite.animation = "idle"
	add_child(sprite)

func _process(delta: float) -> void:
	advance(delta)

func advance(delta: float) -> void:
	if not active or route.is_empty():
		return
	elapsed += delta
	var cycle := fmod(elapsed + phase_offset, 12.0)
	phase = "walk" if cycle < 7.0 else ("graze" if cycle < 10.5 else ("turn" if cycle < 11.0 else "idle"))
	if phase == "walk":
		var target := route[route_index]
		var old := tile_position
		tile_position = tile_position.move_toward(target, delta * 0.58)
		var movement := tile_position - old
		distance_walked += movement.length()
		if absf(movement.x - movement.y) > 0.00001:
			facing_right = movement.x - movement.y > 0.0
		if tile_position.distance_to(target) < 0.001:
			route_index = (route_index + 1) % route.size()
	position = Iso.project(tile_position)
	# One shared foot anchor and distance-based, actually different leg frames.
	sprite.animation = phase
	sprite.frame = int(distance_walked / 0.18) % 4 if phase == "walk" else 0
	sprite.scale.x = absf(sprite.scale.x) * (-1.0 if facing_right else 1.0)

func snapshot() -> Dictionary:
	return {"species": species, "x": tile_position.x, "y": tile_position.y, "phase": phase, "frame": sprite.frame, "distance": distance_walked}
