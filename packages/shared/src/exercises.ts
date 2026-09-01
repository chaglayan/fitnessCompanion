import type {
  Equipment,
  Exercise,
  InjuryArea,
  Metric,
  Muscle,
  Pattern,
} from "./types.js";

interface ExerciseSeed {
  id: string;
  name: string;
  pattern: Pattern;
  equipment: Equipment[];
  primary: Muscle[];
  description: string;
  cues: string[];
  aliases?: string[];
  secondary?: Muscle[];
  metric?: Metric;
  unilateral?: boolean;
  difficulty?: 1 | 2 | 3;
  stresses?: InjuryArea[];
  restSec?: number;
  staple?: boolean;
  /** Overrides the default "<name> proper form" YouTube search query. */
  video?: string;
  loadFactor?: number;
}

function ex(seed: ExerciseSeed): Exercise {
  return {
    id: seed.id,
    name: seed.name,
    aliases: seed.aliases ?? [],
    pattern: seed.pattern,
    equipment: seed.equipment,
    primary: seed.primary,
    secondary: seed.secondary ?? [],
    metric: seed.metric ?? "reps",
    unilateral: seed.unilateral ?? false,
    difficulty: seed.difficulty ?? 1,
    stresses: seed.stresses ?? [],
    restSec: seed.restSec ?? 90,
    description: seed.description,
    cues: seed.cues,
    staple: seed.staple ?? false,
    video: { query: seed.video ?? `${seed.name} proper form technique` },
    ...(seed.loadFactor === undefined ? {} : { loadFactor: seed.loadFactor }),
  };
}

/**
 * Builds the link shown when an exercise name is tapped. A curated
 * `youtubeId` links straight to that clip; otherwise it falls back to a
 * YouTube search, which always resolves to relevant demonstrations.
 */
export function videoUrl(exercise: Exercise): string {
  const { youtubeId, query } = exercise.video;
  return youtubeId
    ? `https://www.youtube.com/watch?v=${youtubeId}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export const EXERCISES: Exercise[] = [
  /* ---------------------------- SQUAT ---------------------------- */
  ex({
    id: "bw_squat",
    staple: true,
    name: "Bodyweight Squat",
    aliases: ["air squat"],
    pattern: "squat",
    equipment: ["bodyweight"],
    primary: ["quads", "glutes"],
    secondary: ["core"],
    stresses: ["knee"],
    restSec: 60,
    description:
      "Stand with feet shoulder-width apart and sit down and back until your thighs are at least parallel to the floor, then drive back up through mid-foot.",
    cues: [
      "Push your knees out in line with your toes",
      "Keep your chest tall and heels flat",
      "Brace your core before you descend",
    ],
  }),
  ex({
    id: "goblet_squat",
    staple: true,
    name: "Goblet Squat",
    pattern: "squat",
    equipment: ["dumbbell"],
    primary: ["quads", "glutes"],
    secondary: ["core", "shoulders"],
    difficulty: 1,
    stresses: ["knee"],
    loadFactor: 0.35,
    description:
      "Hold a dumbbell or kettlebell vertically against your chest and squat down between your knees, keeping the weight close to your sternum throughout.",
    cues: [
      "Elbows tucked inside your knees at the bottom",
      "Let the weight counterbalance you — sit straight down",
      "Drive the floor away on the way up",
    ],
  }),
  ex({
    id: "back_squat",
    staple: true,
    name: "Barbell Back Squat",
    aliases: ["back squat", "squat"],
    pattern: "squat",
    equipment: ["barbell", "rack"],
    primary: ["quads", "glutes"],
    secondary: ["core", "lower_back", "hamstrings"],
    difficulty: 2,
    stresses: ["knee", "lower_back"],
    restSec: 180,
    loadFactor: 1.0,
    description:
      "With the bar racked across your upper back, squat to at least parallel and stand back up, keeping the bar stacked over mid-foot the whole time.",
    cues: [
      "Big breath into the belly and brace before you unrack",
      "Break at hips and knees together",
      "Keep the bar path vertical over mid-foot",
    ],
  }),
  ex({
    id: "front_squat",
    name: "Barbell Front Squat",
    pattern: "squat",
    equipment: ["barbell", "rack"],
    primary: ["quads"],
    secondary: ["core", "glutes", "shoulders"],
    difficulty: 3,
    stresses: ["knee", "wrist"],
    restSec: 180,
    loadFactor: 0.8,
    description:
      "Rack the bar across the front of your shoulders with elbows high, then squat down and up keeping your torso as upright as possible.",
    cues: [
      "Elbows up — losing them dumps the bar forward",
      "Fingers only under the bar, it rests on the shoulders",
      "Stay upright and let the knees travel forward",
    ],
  }),
  ex({
    id: "bulgarian_split_squat",
    name: "Bulgarian Split Squat",
    aliases: ["rear foot elevated split squat", "rfess"],
    pattern: "squat",
    equipment: ["bodyweight", "bench"],
    primary: ["quads", "glutes"],
    secondary: ["core", "adductors"],
    unilateral: true,
    difficulty: 2,
    stresses: ["knee"],
    restSec: 90,
    loadFactor: 0.3,
    description:
      "With your rear foot on a bench behind you, lower straight down until the back knee nearly touches the floor, then drive up through the front heel.",
    cues: [
      "Front shin roughly vertical at the bottom",
      "Drop straight down, don't lunge forward",
      "Keep most of your weight on the front leg",
    ],
  }),
  ex({
    id: "pistol_squat",
    name: "Pistol Squat",
    aliases: ["single leg squat"],
    pattern: "squat",
    equipment: ["bodyweight"],
    primary: ["quads", "glutes"],
    secondary: ["core", "hamstrings"],
    unilateral: true,
    difficulty: 3,
    stresses: ["knee", "ankle"],
    description:
      "Standing on one leg with the other extended in front, lower all the way to the bottom and stand back up without touching down.",
    cues: [
      "Reach the free leg forward as a counterweight",
      "Keep the working heel planted",
      "Hold a doorframe for balance while you build the strength",
    ],
  }),
  ex({
    id: "wall_sit",
    name: "Wall Sit",
    pattern: "squat",
    equipment: ["bodyweight"],
    primary: ["quads"],
    secondary: ["glutes", "core"],
    metric: "time",
    difficulty: 1,
    stresses: ["knee"],
    restSec: 60,
    description:
      "Slide down a wall until your knees and hips are at 90 degrees and hold the position for time.",
    cues: [
      "Thighs parallel to the floor",
      "Back flat against the wall",
      "Breathe steadily — don't hold your breath",
    ],
  }),
  ex({
    id: "jump_squat",
    name: "Jump Squat",
    pattern: "squat",
    equipment: ["bodyweight"],
    primary: ["quads", "glutes"],
    secondary: ["calves", "core"],
    difficulty: 2,
    stresses: ["knee", "ankle"],
    restSec: 90,
    description:
      "Drop into a quarter-to-half squat and jump as high as you can, absorbing the landing softly into the next rep.",
    cues: [
      "Land quietly, toes then heels",
      "Absorb by bending knees and hips",
      "Full hip extension at the top",
    ],
  }),

  /* ---------------------------- HINGE ---------------------------- */
  ex({
    id: "glute_bridge",
    staple: true,
    name: "Glute Bridge",
    pattern: "hinge",
    equipment: ["bodyweight"],
    primary: ["glutes"],
    secondary: ["hamstrings", "core"],
    difficulty: 1,
    restSec: 60,
    description:
      "Lying on your back with knees bent and feet flat, drive through your heels to lift your hips until your body forms a straight line from knee to shoulder.",
    cues: [
      "Squeeze the glutes at the top, don't arch the low back",
      "Ribs down, posterior pelvic tilt",
      "Push through the heels",
    ],
  }),
  ex({
    id: "hip_thrust",
    name: "Barbell Hip Thrust",
    pattern: "hinge",
    equipment: ["barbell", "bench"],
    primary: ["glutes"],
    secondary: ["hamstrings", "core"],
    difficulty: 2,
    stresses: ["lower_back"],
    restSec: 120,
    loadFactor: 0.9,
    description:
      "With your upper back on a bench and a padded bar across your hips, drive your hips up to full extension and lower under control.",
    cues: [
      "Chin tucked, ribs down",
      "Finish with a hard glute squeeze, shins vertical",
      "Don't hyperextend the lower back at the top",
    ],
  }),
  ex({
    id: "rdl_barbell",
    staple: true,
    name: "Barbell Romanian Deadlift",
    aliases: ["rdl"],
    pattern: "hinge",
    equipment: ["barbell"],
    primary: ["hamstrings", "glutes"],
    secondary: ["lower_back", "back", "forearms"],
    difficulty: 2,
    stresses: ["lower_back"],
    restSec: 150,
    loadFactor: 0.75,
    description:
      "From standing, push your hips back and lower the bar along your legs until you feel a strong hamstring stretch, then drive the hips forward to stand.",
    cues: [
      "Hips back, not down — this is not a squat",
      "Bar stays in contact with your legs",
      "Flat back throughout; stop when your back would round",
    ],
  }),
  ex({
    id: "rdl_dumbbell",
    staple: true,
    name: "Dumbbell Romanian Deadlift",
    pattern: "hinge",
    equipment: ["dumbbell"],
    primary: ["hamstrings", "glutes"],
    secondary: ["lower_back", "forearms"],
    difficulty: 1,
    stresses: ["lower_back"],
    restSec: 90,
    loadFactor: 0.4,
    description:
      "Holding dumbbells in front of your thighs, hinge at the hips and lower the weights down your legs, then stand tall by squeezing your glutes.",
    cues: [
      "Soft knees, but the movement comes from the hips",
      "Weights slide down the front of the legs",
      "Neutral spine — chest stays proud",
    ],
  }),
  ex({
    id: "deadlift",
    staple: true,
    name: "Barbell Deadlift",
    aliases: ["conventional deadlift"],
    pattern: "hinge",
    equipment: ["barbell"],
    primary: ["hamstrings", "glutes", "back"],
    secondary: ["lower_back", "traps", "forearms", "core"],
    difficulty: 3,
    stresses: ["lower_back"],
    restSec: 210,
    loadFactor: 1.2,
    description:
      "With the bar over mid-foot, hinge down and grip it, then push the floor away and stand up, keeping the bar dragging up your legs.",
    cues: [
      "Take the slack out of the bar before you pull",
      "Chest up, lats engaged — 'protect your armpits'",
      "Hips and shoulders rise together",
    ],
  }),
  ex({
    id: "kb_swing",
    staple: true,
    name: "Kettlebell Swing",
    pattern: "hinge",
    equipment: ["kettlebell"],
    primary: ["glutes", "hamstrings"],
    secondary: ["core", "back", "shoulders"],
    difficulty: 2,
    stresses: ["lower_back"],
    restSec: 75,
    loadFactor: 0.3,
    description:
      "Hike the kettlebell back between your legs and snap your hips forward to float it up to chest height, letting it fall back into the next rep.",
    cues: [
      "It is a hip snap, not a front raise",
      "Bell floats — arms stay relaxed",
      "Stand tall and squeeze glutes at the top",
    ],
  }),
  ex({
    id: "nordic_curl",
    name: "Nordic Hamstring Curl",
    pattern: "hinge",
    equipment: ["bodyweight"],
    primary: ["hamstrings"],
    secondary: ["glutes", "core"],
    difficulty: 3,
    stresses: ["knee"],
    restSec: 120,
    description:
      "Kneel with your ankles anchored and lower your torso toward the floor as slowly as you can, catching yourself with your hands and pushing back up.",
    cues: [
      "Hips stay extended — don't fold at the waist",
      "Fight the descent for as long as possible",
      "Start with a small range and build",
    ],
  }),
  ex({
    id: "back_extension",
    name: "Back Extension",
    aliases: ["hyperextension", "superman"],
    pattern: "hinge",
    equipment: ["bodyweight"],
    primary: ["lower_back"],
    secondary: ["glutes", "hamstrings"],
    difficulty: 1,
    stresses: ["lower_back"],
    restSec: 60,
    description:
      "Lying face down, lift your chest and legs off the floor simultaneously, hold briefly at the top, and lower under control.",
    cues: [
      "Lift with the glutes and mid-back, not the neck",
      "Look at the floor to keep the neck neutral",
      "Small range done well beats a big range done badly",
    ],
  }),

  /* ---------------------------- LUNGE ---------------------------- */
  ex({
    id: "reverse_lunge",
    staple: true,
    name: "Reverse Lunge",
    pattern: "lunge",
    equipment: ["bodyweight"],
    primary: ["quads", "glutes"],
    secondary: ["hamstrings", "core"],
    unilateral: true,
    difficulty: 1,
    stresses: ["knee"],
    restSec: 75,
    loadFactor: 0.3,
    description:
      "Step one foot back and lower until both knees are near 90 degrees, then drive through the front heel to return to standing.",
    cues: [
      "Step back, not down — easier on the knees than a forward lunge",
      "Torso upright",
      "Front shin vertical",
    ],
  }),
  ex({
    id: "walking_lunge",
    name: "Walking Lunge",
    pattern: "lunge",
    equipment: ["bodyweight"],
    primary: ["quads", "glutes"],
    secondary: ["hamstrings", "core", "calves"],
    unilateral: true,
    difficulty: 2,
    stresses: ["knee"],
    restSec: 90,
    description:
      "Lunge forward, then bring the back leg through into the next lunge, travelling forward with each rep.",
    cues: [
      "Long enough step that the front shin stays vertical",
      "Back knee kisses the floor",
      "Stay tall — resist leaning forward",
    ],
  }),
  ex({
    id: "lateral_lunge",
    name: "Lateral Lunge",
    pattern: "lunge",
    equipment: ["bodyweight"],
    primary: ["quads", "glutes", "adductors"],
    secondary: ["hamstrings"],
    unilateral: true,
    difficulty: 2,
    stresses: ["knee", "hip"],
    restSec: 75,
    description:
      "Step wide to one side and sit back into that hip while the other leg stays straight, then push back to the middle.",
    cues: [
      "Sit back into the hip, chest up",
      "Straight leg keeps its foot flat",
      "Push hard off the bent leg to return",
    ],
  }),
  ex({
    id: "step_up",
    name: "Step-Up",
    pattern: "lunge",
    equipment: ["bodyweight", "box"],
    primary: ["quads", "glutes"],
    secondary: ["calves", "core"],
    unilateral: true,
    difficulty: 1,
    stresses: ["knee"],
    restSec: 75,
    loadFactor: 0.3,
    description:
      "Place one foot on a box or bench and drive through that heel to stand up on it, then lower under control.",
    cues: [
      "Don't push off the trailing foot",
      "Whole foot on the box",
      "Lower slowly instead of dropping",
    ],
  }),

  /* ----------------------- PUSH (HORIZONTAL) --------------------- */
  ex({
    id: "pushup",
    staple: true,
    name: "Push-Up",
    aliases: ["press up"],
    pattern: "push_horizontal",
    equipment: ["bodyweight"],
    primary: ["chest", "triceps"],
    secondary: ["shoulders", "core"],
    difficulty: 1,
    stresses: ["shoulder", "wrist", "elbow"],
    restSec: 75,
    description:
      "In a straight-body plank position, lower your chest to just above the floor with elbows at roughly 45 degrees, then press back up.",
    cues: [
      "Body is one straight line from head to heels",
      "Elbows at ~45°, not flared to 90°",
      "Full lockout at the top, squeeze the glutes",
    ],
  }),
  ex({
    id: "incline_pushup",
    name: "Incline Push-Up",
    pattern: "push_horizontal",
    equipment: ["bodyweight", "bench"],
    primary: ["chest", "triceps"],
    secondary: ["shoulders", "core"],
    difficulty: 1,
    stresses: ["shoulder", "wrist"],
    restSec: 60,
    description:
      "Push-up with your hands elevated on a bench, box, or wall — the higher the hands, the easier the movement.",
    cues: [
      "Same straight-line body position as a floor push-up",
      "Raise the hands higher to regress, lower to progress",
      "Control the descent",
    ],
  }),
  ex({
    id: "diamond_pushup",
    name: "Diamond Push-Up",
    pattern: "push_horizontal",
    equipment: ["bodyweight"],
    primary: ["triceps", "chest"],
    secondary: ["shoulders", "core"],
    difficulty: 2,
    stresses: ["elbow", "wrist", "shoulder"],
    restSec: 75,
    description:
      "Push-up with your hands close together forming a diamond under your chest, biasing the triceps.",
    cues: [
      "Elbows stay close to the ribs",
      "Lower to the hands, not the neck",
      "Skip it if your wrists complain — use a close-grip push-up instead",
    ],
  }),
  ex({
    id: "archer_pushup",
    name: "Archer Push-Up",
    pattern: "push_horizontal",
    equipment: ["bodyweight"],
    primary: ["chest", "triceps"],
    secondary: ["shoulders", "core"],
    unilateral: true,
    difficulty: 3,
    stresses: ["shoulder", "wrist", "elbow"],
    restSec: 90,
    description:
      "From a wide push-up position, bend one arm and lower toward that hand while the other arm stays straight, shifting most of the load to one side.",
    cues: [
      "Straight arm stays straight",
      "Hips stay square to the floor",
      "A stepping stone toward the one-arm push-up",
    ],
  }),
  ex({
    id: "bench_press",
    staple: true,
    name: "Barbell Bench Press",
    pattern: "push_horizontal",
    equipment: ["barbell", "bench", "rack"],
    primary: ["chest"],
    secondary: ["triceps", "shoulders"],
    difficulty: 2,
    stresses: ["shoulder", "elbow"],
    restSec: 180,
    loadFactor: 0.75,
    description:
      "Lying on a bench, lower the bar to your mid-chest with control and press it back to lockout over your shoulders.",
    cues: [
      "Shoulder blades pinned back and down",
      "Feet planted, slight arch in the upper back",
      "Bar touches mid-chest, elbows ~45°",
    ],
  }),
  ex({
    id: "db_bench_press",
    staple: true,
    name: "Dumbbell Bench Press",
    pattern: "push_horizontal",
    equipment: ["dumbbell", "bench"],
    primary: ["chest"],
    secondary: ["triceps", "shoulders"],
    difficulty: 1,
    stresses: ["shoulder", "elbow"],
    restSec: 120,
    loadFactor: 0.3,
    description:
      "Press two dumbbells from chest level to lockout above your shoulders, allowing a deeper stretch than a barbell permits.",
    cues: [
      "Wrists stacked over elbows",
      "Lower until you feel a stretch, don't force depth",
      "Squeeze the dumbbells together at the top",
    ],
  }),
  ex({
    id: "floor_press",
    name: "Dumbbell Floor Press",
    pattern: "push_horizontal",
    equipment: ["dumbbell"],
    primary: ["chest", "triceps"],
    secondary: ["shoulders"],
    difficulty: 1,
    stresses: ["elbow"],
    restSec: 90,
    loadFactor: 0.28,
    description:
      "Pressing while lying on the floor, so the range stops when your triceps touch down — a shoulder-friendly bench alternative.",
    cues: [
      "Upper arms touch the floor, brief pause",
      "Good option when the shoulder is cranky",
      "Keep the ribs down",
    ],
  }),
  ex({
    id: "dip",
    name: "Dip",
    pattern: "push_horizontal",
    equipment: ["dip_bar"],
    primary: ["chest", "triceps"],
    secondary: ["shoulders", "core"],
    difficulty: 3,
    stresses: ["shoulder", "elbow", "wrist"],
    restSec: 120,
    description:
      "Supporting yourself on parallel bars, lower until your upper arms are roughly parallel to the floor, then press back to lockout.",
    cues: [
      "Lean forward slightly for chest, stay upright for triceps",
      "Shoulders stay down and away from the ears",
      "Stop the descent before the shoulder rolls forward",
    ],
  }),

  /* ------------------------ PUSH (VERTICAL) ---------------------- */
  ex({
    id: "pike_pushup",
    staple: true,
    name: "Pike Push-Up",
    pattern: "push_vertical",
    equipment: ["bodyweight"],
    primary: ["shoulders"],
    secondary: ["triceps", "core"],
    difficulty: 2,
    stresses: ["shoulder", "wrist"],
    restSec: 90,
    description:
      "From a downward-dog position with hips high, bend your elbows to lower the crown of your head toward the floor, then press back up.",
    cues: [
      "Hips stay high — that is what makes it vertical pressing",
      "Head travels down in front of the hands",
      "Elevate the feet to make it harder",
    ],
  }),
  ex({
    id: "handstand_pushup",
    name: "Handstand Push-Up",
    aliases: ["hspu"],
    pattern: "push_vertical",
    equipment: ["bodyweight"],
    primary: ["shoulders", "triceps"],
    secondary: ["core", "traps"],
    difficulty: 3,
    stresses: ["shoulder", "wrist", "neck"],
    restSec: 150,
    description:
      "Kick up to a handstand against a wall and press your body up and down through a full-range shoulder press.",
    cues: [
      "Hands slightly wider than shoulders",
      "Body stays hollow, ribs tucked",
      "Build with negatives before full reps",
    ],
  }),
  ex({
    id: "ohp",
    staple: true,
    name: "Barbell Overhead Press",
    aliases: ["strict press", "military press", "ohp"],
    pattern: "push_vertical",
    equipment: ["barbell", "rack"],
    primary: ["shoulders"],
    secondary: ["triceps", "core", "traps"],
    difficulty: 2,
    stresses: ["shoulder", "lower_back"],
    restSec: 150,
    loadFactor: 0.5,
    description:
      "From the front rack at shoulder height, press the bar overhead to a full lockout with the bar finishing over the mid-foot.",
    cues: [
      "Squeeze glutes and abs — don't lean back",
      "Move your head back to let the bar pass, then push it through",
      "Finish with biceps by the ears",
    ],
  }),
  ex({
    id: "db_shoulder_press",
    staple: true,
    name: "Dumbbell Shoulder Press",
    pattern: "push_vertical",
    equipment: ["dumbbell"],
    primary: ["shoulders"],
    secondary: ["triceps", "core"],
    difficulty: 1,
    stresses: ["shoulder"],
    restSec: 105,
    loadFactor: 0.2,
    description:
      "Press dumbbells from shoulder height to overhead lockout, either seated or standing.",
    cues: [
      "Wrists stacked over elbows",
      "Ribs down, don't arch the lower back",
      "Neutral (palms-facing) grip if the shoulder is irritable",
    ],
  }),

  /* ----------------------- PULL (HORIZONTAL) --------------------- */
  ex({
    id: "inverted_row",
    staple: true,
    name: "Inverted Row",
    aliases: ["bodyweight row", "australian pullup"],
    pattern: "pull_horizontal",
    equipment: ["bodyweight", "bench"],
    primary: ["back", "lats"],
    secondary: ["biceps", "core", "forearms"],
    difficulty: 1,
    stresses: ["elbow"],

    restSec: 90,
    description:
      "Hanging under a bar or sturdy table with a straight body, pull your chest to the bar and lower under control.",
    cues: [
      "Body stays in one rigid line",
      "Lead with the chest, squeeze the shoulder blades",
      "Walk the feet further out to make it harder",
    ],
  }),
  ex({
    id: "barbell_row",
    staple: true,
    name: "Barbell Row",
    aliases: ["bent over row"],
    pattern: "pull_horizontal",
    equipment: ["barbell"],
    primary: ["back", "lats"],
    secondary: ["biceps", "lower_back", "forearms", "traps"],
    difficulty: 2,
    stresses: ["lower_back"],

    restSec: 120,
    loadFactor: 0.6,
    description:
      "Hinged over with a flat back, row the bar to your lower ribs and lower it under control without letting the torso rise.",
    cues: [
      "Torso angle stays fixed for the whole set",
      "Pull to the belly button, not the chest",
      "Squeeze the shoulder blades at the top",
    ],
  }),
  ex({
    id: "db_row",
    staple: true,
    name: "Single-Arm Dumbbell Row",
    pattern: "pull_horizontal",
    equipment: ["dumbbell", "bench"],
    primary: ["back", "lats"],
    secondary: ["biceps", "forearms", "core"],
    unilateral: true,
    difficulty: 1,
    restSec: 90,
    loadFactor: 0.3,
    description:
      "With one hand and knee on a bench, row the dumbbell from a full stretch up to your hip, keeping your torso square.",
    cues: [
      "Let the shoulder blade stretch forward at the bottom",
      "Pull the elbow toward the hip",
      "Don't rotate the torso to lift more",
    ],
  }),
  ex({
    id: "band_row",
    name: "Band Row",
    pattern: "pull_horizontal",
    equipment: ["bands"],
    primary: ["back", "lats"],
    secondary: ["biceps", "forearms"],
    difficulty: 1,
    stresses: ["elbow"],
    restSec: 60,
    description:
      "Anchor a band at chest height and row the handles to your ribs, squeezing your shoulder blades together at the end range.",
    cues: [
      "Step back to add tension",
      "Elbows brush past the ribs",
      "Control the return — don't let the band snap you forward",
    ],
  }),

  /* ------------------------ PULL (VERTICAL) ---------------------- */
  ex({
    id: "pullup",
    staple: true,
    name: "Pull-Up",
    pattern: "pull_vertical",
    equipment: ["pullup_bar"],
    primary: ["lats", "back"],
    secondary: ["biceps", "forearms", "core"],
    difficulty: 3,
    stresses: ["shoulder", "elbow"],
    restSec: 150,
    description:
      "Hanging from a bar with an overhand grip, pull until your chin clears the bar, then lower to a full hang.",
    cues: [
      "Start from a dead hang with shoulders engaged",
      "Drive the elbows down to your ribs",
      "No kipping — keep the body tight and vertical",
    ],
  }),
  ex({
    id: "chinup",
    staple: true,
    name: "Chin-Up",
    pattern: "pull_vertical",
    equipment: ["pullup_bar"],
    primary: ["lats", "biceps"],
    secondary: ["back", "forearms", "core"],
    difficulty: 2,
    stresses: ["shoulder", "elbow"],
    restSec: 150,
    description:
      "A pull-up with an underhand, shoulder-width grip — more biceps involvement and usually a few reps easier than a pull-up.",
    cues: [
      "Chest to the bar, elbows driving down",
      "Full extension at the bottom",
      "Great substitution when overhand grip bothers the shoulder",
    ],
  }),
  ex({
    id: "band_assisted_pullup",
    name: "Band-Assisted Pull-Up",
    pattern: "pull_vertical",
    equipment: ["pullup_bar", "bands"],
    primary: ["lats", "back"],
    secondary: ["biceps", "forearms"],
    difficulty: 1,
    stresses: ["shoulder", "elbow"],
    restSec: 120,
    description:
      "A pull-up with a resistance band looped over the bar and under your foot or knee, taking some of your bodyweight.",
    cues: [
      "Thicker band = more help; step down a band as you get stronger",
      "Same full range as an unassisted rep",
      "Keep tension — don't bounce out of the bottom",
    ],
  }),
  ex({
    id: "negative_pullup",
    name: "Negative Pull-Up",
    pattern: "pull_vertical",
    equipment: ["pullup_bar"],
    primary: ["lats", "back"],
    secondary: ["biceps", "forearms"],
    metric: "time",
    difficulty: 2,
    stresses: ["shoulder", "elbow"],
    restSec: 120,
    description:
      "Jump or step to the top of a pull-up and lower yourself as slowly as possible; the target is total time under tension.",
    cues: [
      "Aim for a 5+ second descent",
      "Stay tight all the way to a dead hang",
      "The fastest route to your first strict pull-up",
    ],
  }),
  ex({
    id: "lat_pulldown",
    name: "Lat Pulldown",
    pattern: "pull_vertical",
    equipment: ["cable"],
    primary: ["lats", "back"],
    secondary: ["biceps", "forearms"],
    difficulty: 1,
    stresses: ["shoulder"],
    restSec: 90,
    loadFactor: 0.5,
    description:
      "Seated at a cable machine, pull the bar down to your upper chest and control it back to full stretch overhead.",
    cues: [
      "Slight backward lean, chest up",
      "Pull with the elbows, not the hands",
      "Full stretch at the top of each rep",
    ],
  }),
  ex({
    id: "scap_pullup",
    name: "Scapular Pull-Up",
    pattern: "pull_vertical",
    equipment: ["pullup_bar"],
    primary: ["back", "traps"],
    secondary: ["lats", "forearms"],
    difficulty: 1,
    restSec: 45,
    description:
      "Hanging from a bar with straight arms, pull your shoulder blades down and back to raise your body a few inches, then release.",
    cues: [
      "Arms stay straight the whole time",
      "Small movement — think 'shrug down'",
      "Excellent warm-up before any pulling",
    ],
  }),

  /* ---------------------------- CARRY ---------------------------- */
  ex({
    id: "farmer_carry",
    staple: true,
    name: "Farmer's Carry",
    pattern: "carry",
    equipment: ["dumbbell"],
    primary: ["forearms", "traps", "core"],
    secondary: ["shoulders", "glutes"],
    metric: "distance",
    difficulty: 1,
    restSec: 90,
    loadFactor: 0.5,
    description:
      "Hold a heavy weight in each hand and walk for distance with tall posture and a braced trunk.",
    cues: [
      "Shoulders back and down, chest tall",
      "Short, quick steps",
      "Don't let the weights swing",
    ],
  }),
  ex({
    id: "suitcase_carry",
    name: "Suitcase Carry",
    pattern: "carry",
    equipment: ["dumbbell"],
    primary: ["core", "obliques"],
    secondary: ["forearms", "traps", "glutes"],
    metric: "distance",
    unilateral: true,
    difficulty: 1,
    restSec: 75,
    description:
      "Carry a single heavy weight in one hand while resisting any sideways lean — a hard anti-lateral-flexion core exercise.",
    cues: [
      "Stay perfectly upright, both shoulders level",
      "Brace the side that is not loaded",
      "Walk the same distance on each side",
    ],
  }),

  /* ----------------------------- CORE ---------------------------- */
  ex({
    id: "plank",
    staple: true,
    name: "Plank",
    pattern: "core",
    equipment: ["bodyweight"],
    primary: ["core"],
    secondary: ["shoulders", "glutes"],
    metric: "time",
    difficulty: 1,
    stresses: ["lower_back"],

    restSec: 45,
    description:
      "Hold a straight-body position on your forearms and toes, keeping your hips level and your core braced.",
    cues: [
      "Squeeze glutes and quads, tuck the ribs down",
      "Hips level — no sagging or piking",
      "Quality over duration: stop when the form breaks",
    ],
  }),
  ex({
    id: "side_plank",
    name: "Side Plank",
    pattern: "core",
    equipment: ["bodyweight"],
    primary: ["obliques", "core"],
    secondary: ["shoulders", "glutes"],
    metric: "time",
    unilateral: true,
    difficulty: 1,
    stresses: ["shoulder"],
    restSec: 45,
    description:
      "Supported on one forearm and the side of your foot, hold your body in a straight line with your hips lifted.",
    cues: [
      "Stack the shoulders, hips, and feet",
      "Push the floor away with the down shoulder",
      "Drop to the bottom knee to regress",
    ],
  }),
  ex({
    id: "hollow_hold",
    name: "Hollow Body Hold",
    pattern: "core",
    equipment: ["bodyweight"],
    primary: ["core"],
    secondary: ["hip_flexors"],
    metric: "time",
    difficulty: 2,
    stresses: ["lower_back", "neck"],
    restSec: 60,
    description:
      "Lying on your back, press your lower back into the floor and lift your shoulders and legs into a shallow banana shape, then hold.",
    cues: [
      "Lower back must stay glued to the floor",
      "Bend the knees or raise the legs higher to regress",
      "Breathe — don't hold your breath",
    ],
  }),
  ex({
    id: "dead_bug",
    staple: true,
    name: "Dead Bug",
    pattern: "core",
    equipment: ["bodyweight"],
    primary: ["core"],
    secondary: ["hip_flexors"],
    difficulty: 1,
    restSec: 45,
    description:
      "On your back with arms and knees up, slowly extend one arm and the opposite leg without letting your lower back arch.",
    cues: [
      "Ribs down, low back pressed into the floor",
      "Move slowly and exhale as you extend",
      "Shorten the range if the back lifts",
    ],
  }),
  ex({
    id: "bird_dog",
    name: "Bird Dog",
    pattern: "core",
    equipment: ["bodyweight"],
    primary: ["core", "lower_back"],
    secondary: ["glutes", "shoulders"],
    difficulty: 1,
    restSec: 45,
    description:
      "On hands and knees, extend one arm and the opposite leg until both are level with your torso, then return under control.",
    cues: [
      "Hips stay square to the floor",
      "Reach long rather than lifting high",
      "Pause for a second at full extension",
    ],
  }),
  ex({
    id: "hanging_knee_raise",
    staple: true,
    name: "Hanging Knee Raise",
    pattern: "core",
    equipment: ["pullup_bar"],
    primary: ["core", "hip_flexors"],
    secondary: ["forearms", "obliques"],
    difficulty: 2,
    stresses: ["shoulder", "lower_back"],
    restSec: 75,
    description:
      "Hanging from a bar, raise your knees toward your chest with control and lower without swinging.",
    cues: [
      "Curl the pelvis up at the top — don't just lift the legs",
      "No swinging; pause at the bottom if you build momentum",
      "Straighten the legs to progress toward toes-to-bar",
    ],
  }),
  ex({
    id: "ab_wheel",
    name: "Ab Wheel Rollout",
    pattern: "core",
    equipment: ["ab_wheel"],
    primary: ["core"],
    secondary: ["lats", "shoulders"],
    difficulty: 3,
    stresses: ["lower_back", "shoulder"],
    restSec: 90,
    description:
      "From your knees, roll the wheel forward as far as you can while keeping your back flat, then pull yourself back.",
    cues: [
      "Ribs down and hips tucked the whole way",
      "Only go as far as you can without arching",
      "Stop immediately if you feel it in the lower back",
    ],
  }),
  ex({
    id: "pallof_press",
    name: "Pallof Press",
    pattern: "core",
    equipment: ["bands"],
    primary: ["core", "obliques"],
    secondary: ["shoulders"],
    unilateral: true,
    difficulty: 1,
    restSec: 60,
    description:
      "With a band anchored at chest height to your side, press the handle straight out and resist the rotational pull.",
    cues: [
      "Do not let the torso rotate — that is the whole exercise",
      "Press slowly, hold at full extension",
      "Step further from the anchor to increase difficulty",
    ],
  }),
  ex({
    id: "mountain_climber",
    name: "Mountain Climber",
    pattern: "core",
    equipment: ["bodyweight"],
    primary: ["core"],
    secondary: ["shoulders", "hip_flexors", "quads"],
    metric: "time",
    difficulty: 1,
    stresses: ["wrist", "shoulder"],
    restSec: 45,
    description:
      "From a push-up position, drive your knees toward your chest one at a time at a running pace.",
    cues: [
      "Hips stay low and level",
      "Hands directly under the shoulders",
      "Slow down to keep the plank solid",
    ],
  }),

  /* ------------------------- CONDITIONING ------------------------ */
  ex({
    id: "burpee",
    staple: true,
    name: "Burpee",
    pattern: "conditioning",
    equipment: ["bodyweight"],
    primary: ["full_body"],
    secondary: ["chest", "quads", "core", "shoulders"],
    difficulty: 2,
    stresses: ["wrist", "knee", "lower_back"],
    restSec: 60,
    description:
      "Drop to the floor and perform a push-up, jump your feet back in, and finish with a jump — a full-body conditioning staple.",
    cues: [
      "Chest touches the floor on each rep",
      "Land softly out of the jump",
      "Step back instead of jumping to lower the impact",
    ],
  }),
  ex({
    id: "jump_rope",
    name: "Jump Rope",
    pattern: "conditioning",
    equipment: ["jump_rope"],
    primary: ["calves", "full_body"],
    secondary: ["shoulders", "forearms"],
    metric: "time",
    difficulty: 1,
    stresses: ["ankle", "knee"],
    restSec: 45,
    description:
      "Skip continuously for time, staying light on the balls of your feet with the turning coming from the wrists.",
    cues: [
      "Small jumps, an inch off the floor is plenty",
      "Elbows close to the ribs, wrists do the work",
      "Relaxed shoulders",
    ],
  }),
  ex({
    id: "high_knees",
    name: "High Knees",
    pattern: "conditioning",
    equipment: ["bodyweight"],
    primary: ["hip_flexors", "quads"],
    secondary: ["calves", "core"],
    metric: "time",
    difficulty: 1,
    stresses: ["knee", "ankle"],
    restSec: 45,
    description:
      "Run on the spot bringing your knees up to hip height at a fast cadence.",
    cues: [
      "Stay on the balls of your feet",
      "Tall posture, quick turnover",
      "Drive the arms in opposition",
    ],
  }),
  ex({
    id: "bear_crawl",
    name: "Bear Crawl",
    pattern: "conditioning",
    equipment: ["bodyweight"],
    primary: ["core", "shoulders"],
    secondary: ["quads", "triceps"],
    metric: "distance",
    difficulty: 2,
    stresses: ["wrist", "shoulder", "knee"],
    restSec: 60,
    description:
      "On hands and toes with knees hovering just off the floor, crawl forward moving opposite hand and foot together.",
    cues: [
      "Knees stay an inch off the floor",
      "Hips low and stable — no rocking",
      "Short steps, controlled pace",
    ],
  }),

  /* -------------------------- ISOLATION -------------------------- */
  ex({
    id: "bicep_curl",
    staple: true,
    name: "Dumbbell Bicep Curl",
    pattern: "isolation",
    equipment: ["dumbbell"],
    primary: ["biceps"],
    secondary: ["forearms"],
    difficulty: 1,
    stresses: ["elbow"],
    restSec: 60,
    loadFactor: 0.12,
    description:
      "Curl the dumbbells from a full hang to shoulder height, keeping your elbows pinned at your sides.",
    cues: [
      "Elbows stay by the ribs — no swinging",
      "Full extension at the bottom",
      "Lower slower than you lift",
    ],
  }),
  ex({
    id: "hammer_curl",
    name: "Hammer Curl",
    pattern: "isolation",
    equipment: ["dumbbell"],
    primary: ["biceps", "forearms"],
    difficulty: 1,
    stresses: ["elbow"],
    restSec: 60,
    loadFactor: 0.13,
    description:
      "A bicep curl with a neutral, palms-facing grip that shifts emphasis onto the brachialis and forearms.",
    cues: [
      "Thumbs point at the ceiling throughout",
      "Elbows fixed at your sides",
      "Usually kinder on the elbow than a supinated curl",
    ],
  }),
  ex({
    id: "tricep_extension",
    name: "Overhead Tricep Extension",
    pattern: "isolation",
    equipment: ["dumbbell"],
    primary: ["triceps"],
    difficulty: 1,
    stresses: ["elbow", "shoulder"],
    restSec: 60,
    loadFactor: 0.15,
    description:
      "Holding one dumbbell overhead with both hands, lower it behind your head by bending the elbows, then extend back up.",
    cues: [
      "Elbows point forward and stay narrow",
      "Upper arms stay still — only the forearms move",
      "Control the stretch at the bottom",
    ],
  }),
  ex({
    id: "lateral_raise",
    staple: true,
    name: "Lateral Raise",
    pattern: "isolation",
    equipment: ["dumbbell"],
    primary: ["shoulders"],
    difficulty: 1,
    stresses: ["shoulder"],
    restSec: 45,
    loadFactor: 0.08,
    description:
      "With a slight bend in the elbows, raise the dumbbells out to the sides until they reach shoulder height, then lower slowly.",
    cues: [
      "Lead with the elbows, not the hands",
      "Stop at shoulder height",
      "Light weight — this is not a power movement",
    ],
  }),
  ex({
    id: "rear_delt_fly",
    name: "Rear Delt Fly",
    pattern: "isolation",
    equipment: ["dumbbell"],
    primary: ["shoulders", "back"],
    secondary: ["traps"],
    difficulty: 1,
    restSec: 45,
    loadFactor: 0.07,
    description:
      "Hinged forward with a flat back, raise the dumbbells out to the sides, squeezing the rear shoulders and upper back.",
    cues: [
      "Thumbs down or neutral, elbows soft",
      "Squeeze the shoulder blades together",
      "Light and controlled — no momentum",
    ],
  }),
  ex({
    id: "face_pull",
    name: "Face Pull",
    pattern: "isolation",
    equipment: ["bands"],
    primary: ["shoulders", "traps"],
    secondary: ["back"],
    difficulty: 1,
    restSec: 45,
    description:
      "Pull a band toward your face with your elbows high, finishing with your hands beside your ears and shoulder blades squeezed.",
    cues: [
      "Elbows stay above the wrists",
      "Pull apart as you pull back",
      "One of the best shoulder-health movements there is",
    ],
  }),
  ex({
    id: "calf_raise",
    staple: true,
    name: "Standing Calf Raise",
    pattern: "isolation",
    equipment: ["bodyweight"],
    primary: ["calves"],
    difficulty: 1,
    stresses: ["ankle"],
    restSec: 45,
    loadFactor: 0.4,
    description:
      "Rise onto the balls of your feet through the fullest range you can, pause at the top, and lower slowly.",
    cues: [
      "Pause for a second at the top",
      "Full stretch at the bottom — use a step for more range",
      "Slow eccentric is where the growth is",
    ],
  }),

  /* --------------------------- MOBILITY -------------------------- */
  ex({
    id: "cat_cow",
    staple: true,
    name: "Cat-Cow",
    pattern: "mobility",
    equipment: ["bodyweight"],
    primary: ["lower_back", "core"],
    metric: "time",
    difficulty: 1,
    restSec: 20,
    description:
      "On hands and knees, alternate between rounding your spine toward the ceiling and letting it sag while lifting your chest.",
    cues: [
      "Move one vertebra at a time",
      "Sync the movement with your breath",
      "Gentle range — this is a warm-up, not a stretch test",
    ],
  }),
  ex({
    id: "worlds_greatest_stretch",
    staple: true,
    name: "World's Greatest Stretch",
    pattern: "mobility",
    equipment: ["bodyweight"],
    primary: ["hip_flexors", "hamstrings"],
    secondary: ["core", "obliques"],
    metric: "time",
    unilateral: true,
    difficulty: 1,
    restSec: 20,
    description:
      "From a deep lunge, drop the back knee, place the inside hand down, and rotate the top arm to the ceiling — hips, thoracic spine, and hamstrings in one move.",
    cues: [
      "Front foot flat, back leg long",
      "Rotate from the mid-back, follow the hand with your eyes",
      "Breathe out as you rotate",
    ],
  }),
  ex({
    id: "hip_90_90",
    name: "90/90 Hip Switch",
    pattern: "mobility",
    equipment: ["bodyweight"],
    primary: ["hip_flexors", "glutes"],
    secondary: ["adductors"],
    metric: "time",
    difficulty: 1,
    stresses: ["knee"],
    restSec: 20,
    description:
      "Seated with both knees bent at 90 degrees, rotate your knees from one side to the other under control.",
    cues: [
      "Chest tall, hands light on the floor",
      "Move slowly through the middle",
      "Lean forward over the front shin for more stretch",
    ],
  }),
  ex({
    id: "thoracic_rotation",
    name: "Thoracic Rotation",
    aliases: ["open book"],
    pattern: "mobility",
    equipment: ["bodyweight"],
    primary: ["back"],
    secondary: ["obliques", "chest"],
    metric: "time",
    unilateral: true,
    difficulty: 1,
    restSec: 20,
    description:
      "Lying on your side with knees bent, open your top arm across your body like a book and follow it with your eyes.",
    cues: [
      "Keep the knees stacked and down",
      "Exhale as you open",
      "Chase rotation in the ribs, not the lower back",
    ],
  }),
  ex({
    id: "shoulder_dislocates",
    name: "Band Shoulder Dislocates",
    pattern: "mobility",
    equipment: ["bands"],
    primary: ["shoulders"],
    secondary: ["chest", "traps"],
    metric: "time",
    difficulty: 1,
    stresses: ["shoulder"],
    restSec: 20,
    description:
      "Holding a band wide, take it from in front of your hips over your head and behind your back with straight arms, then reverse.",
    cues: [
      "Start with a very wide grip and narrow it over time",
      "Arms stay straight",
      "Slow and smooth — never force the end range",
    ],
  }),
  ex({
    id: "ankle_rock",
    name: "Kneeling Ankle Rock",
    pattern: "mobility",
    equipment: ["bodyweight"],
    primary: ["calves"],
    metric: "time",
    unilateral: true,
    difficulty: 1,
    stresses: ["ankle", "knee"],
    restSec: 20,
    description:
      "In a half-kneeling position, drive your front knee forward over your toes while keeping the heel down, then rock back.",
    cues: [
      "Heel stays glued to the floor",
      "Knee tracks over the middle toes",
      "Great before any squatting",
    ],
  }),
];

export const EXERCISE_BY_ID: ReadonlyMap<string, Exercise> = new Map(
  EXERCISES.map((e) => [e.id, e]),
);

/** Resolves a name, alias, or id to an exercise. Used by search and AI swaps. */
export function findExercise(term: string): Exercise | undefined {
  const q = term.trim().toLowerCase();
  if (!q) return undefined;
  const byId = EXERCISE_BY_ID.get(q);
  if (byId) return byId;
  return EXERCISES.find(
    (e) =>
      e.name.toLowerCase() === q ||
      e.aliases.some((a) => a.toLowerCase() === q) ||
      e.name.toLowerCase().includes(q),
  );
}

/**
 * True when every piece of equipment the exercise needs is available.
 *
 * Bodyweight is always available — picking up a barbell does not stop you
 * being able to do a plank — so it never has to be selected explicitly.
 */
export function isAvailable(exercise: Exercise, available: Equipment[]): boolean {
  const set = new Set<Equipment>([...available, "bodyweight"]);
  return exercise.equipment.every((needed) => set.has(needed));
}
