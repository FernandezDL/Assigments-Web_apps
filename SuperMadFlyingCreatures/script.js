(() =>{
    // --------------------------------------------------------
    // Definition of constants
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const headerElement = document.querySelector('header');
    const footerElement = document.querySelector('footer');

    const SCALE = 30;

    const pl = planck;
    const Vec2 = pl.Vec2;

    const TIME_STEP = (1/60);
    const VELOCITY_ITERS = 8;
    const POSITION_ITERS = 3;

    const BIRD_RADIUS = 0.8;
    const BIRD_START = Vec2(5,5);
    const BIRD_STOP_SPEED = 0.15;
    const BIRD_STOP_ANGULAR = 0.25;
    const BIRD_IDLE_SECONDS = 1.0;
    const BIRD_MAX_FLIGHT_SECONDS = 10.0;
    const PIG_RADIUS = 1;

    // --------------------------------------------------------
    // Size of the level editor (defined in LevelEditor's CSS) to convert pixels to units
    const LEVEL_EDITOR_WIDTH = 800;
    const LEVEL_EDITOR_HEIGHT = 600;

    const PositionToPercentage = (x, y) => {
        return {
            x: (x / LEVEL_EDITOR_WIDTH),
            y: (y / LEVEL_EDITOR_HEIGHT)
        }
    }

    // --------------------------------------------------------
    // Resize Canvas
    const resizeCanvas = () =>{
        const headerHight = headerElement?.offsetHeight ?? 0;
        const footerHeight = footerElement?.offsetHeight ?? 0;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight - headerHight - footerHeight;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --------------------------------------------------------
    // Create world
    const createWorld=() =>{
        const world = new pl.World({
            gravity: Vec2(0,-10)
        })

        const ground = world.createBody();
        ground.createFixture(pl.Edge(Vec2(-50,0), Vec2(50,0)),{
            friction: 0.8
        });

        return {world, ground};
    }

    const {world, ground} = createWorld();

    let LOADING = false;

    // --------------------------------------------------------
    // Load levels
    let levels = {
        pigs : [],
        block : [],
        rock: [],
        dirt: [],
        catapult: []
    }

    const LoadLevel = (currentLevel) => (
        fetch(`./levels/${currentLevel}.json`) // reads json of the current level 
        .then(response => {
            if(!response.ok) {
                throw new Error('Error al cargar');
            }
            return response.json();
        })
        .then(data => {
            data.forEach(block => {
                // Holds each block in each array
                switch(block.blockType) {
                    case "block":
                        levels.block.push(block);
                        break;
                    case "rock":
                        levels.rock.push(block);
                        break;
                    case "pig":
                        levels.pigs.push(block);
                        break;
                    case "catapult":
                        levels.catapult.push(block);
                        break;
                    case "dirt":
                        levels.dirt.push(block);
                        break;
                }
            });
            return levels; // return the level variable
        })
        .catch(error => {
            console.log("There was an error while fetching: ", error);
        })
    )

    let state = {
        currentLevel: 0,
        levels: levels,
        score: 0,
        birdsRemaining: 3,
        isLevelCompleted: false,
        pigs: [],
        boxes: [],
        rocks: [],
        catapult: [],
        dirts: [],
        bird: null,
        birdLaunched: false,
        isMouseDown: false,
        mousePos: Vec2(0,0),
        launchVector: Vec2(0,0)
    };

    const setState = (patch) =>{
        state = {...state, ...patch};
    };

    // --------------------------------------------------------
    // Bird time variables
    let birdIdleTime = 0;
    let birdFlightTime = 0;
    let levelCompleteTimer = null;
    let gameOverTimer = null;

    const resetBirdTimers = () =>{
        birdIdleTime = 0;
        birdFlightTime = 0;
    };

    // --------------------------------------------------------
    // plank utils (physics)

    const createBox = (x, y, width, height, dynamic = true) => {
        const calcPos = PositionToPercentage(x, y); // convert level editor position to game position

        // define box 
        const body = world.createBody({
            position: Vec2(calcPos.x * SCALE - width, SCALE - (calcPos.y * SCALE + height)), // calculate box position
            type: dynamic ? 'dynamic' : 'static' // define box type
        });

        body.createFixture(pl.Box(width / 2, height / 2), {
            density: 1.0,
            friction: 0.5,
            restitution: 0.1
        });

        return body;
    };

    const createPig = (x, y)=> {
        const calcPos = PositionToPercentage(x, y); // convert level editor position to game position

        // define pig
        const body = world.createDynamicBody({
            position: Vec2(calcPos.x * SCALE - (PIG_RADIUS * 2), SCALE - (calcPos.y * SCALE + (PIG_RADIUS * 2))) // calculate box position
        });

        body.createFixture(pl.Circle(PIG_RADIUS), {
            density: 0.5,
            friction: 0.5,
            restitution: 0.1,
            userData: 'Pig'
        });

        body.isPig = true; // set as a pig

        return body;
    };

    const createBird =()=>{
        const body = world.createDynamicBody(BIRD_START); // Create bird at the start position

        // define bird
        body.createFixture(pl.Circle(BIRD_RADIUS),{
            density: 1.5,
            friction: 0.6,
            restitution: 0.4
        });

        body.setLinearDamping(0.35);
        body.setAngularDamping(0.35);
        body.setSleepingAllowed(true);

        return body;
    };

    const destroyBirdIfExists = () => {
        if(state.bird){ // If there's a bird
            world.destroyBody(state.bird); // destroy it
        }
    };

    // Destroy everything except the ground
    const clearWorldExceptGround = () =>{
        for(let body = world.getBodyList(); body;){
            const next = body.getNext();
            if(body !== ground) world.destroyBody(body);
            body = next;
        }
    };

    // --------------------------------------------------------
    // level utils

    const initLevel = async (levelIndex) => {
        LOADING = true; // set the loading variable to true

        if(levelCompleteTimer) {
            levelCompleteTimer = null; // reset timer 
        }

        if(gameOverTimer) {
            gameOverTimer = null; // reset timer 
        }

        clearWorldExceptGround(); // Clear all the world

        // set the level variable to empty
        levels = {
            pigs : [],
            block : [],
            rock: [],
            dirt: [],
            catapult: []
        }

        const loadedLevel = await LoadLevel(levelIndex); // Load the current level

        // get all boxes, dirt, rocks, pigs, and catapult
        const boxes = loadedLevel.block.map(b => createBox(b.x, b.y, b.width / SCALE, b.height / SCALE, true));
        const dirts = loadedLevel.dirt.map(b => createBox(b.x, b.y, b.width / SCALE, b.height / SCALE, true));
        const rocks = loadedLevel.rock.map(b => createBox(b.x, b.y, b.width / SCALE, b.height / SCALE, true));
        const catapult = loadedLevel.catapult.map(b => createBox(b.x, b.y, b.width / SCALE, b.height / SCALE, true));
        const pigs = loadedLevel.pigs.map(p => createPig(p.x, p.y));

        const bird = createBird(); // create bird

        // Set state
        setState({
            levels: loadedLevel,
            pigs,
            boxes,
            dirts,
            rocks,
            catapult,
            bird,
            isLevelCompleted: false,
            birdLaunched: false,
            birdsRemaining: 3,
            isMouseDown: false,
            mousePos: Vec2(0,0),
            launchVector: Vec2(0,0)
        });

        LOADING = false; // set loading variable to false
    };

    const resetLevel =()=> initLevel(state.currentLevel); 

    const nextLevel = () => {
        const next = state.currentLevel + 1; // Change level index

        if(next < 2) { // If the level index is less than 2 
            setState({currentLevel: next}); // change level
            initLevel(next); // initialize level
            return;
        }

        // If both levels have been completed
        alert("Congratulations! You've won c:"); // Get alert
        setState({currentLevel: 0, score: 0}); // restart with level 0
        initLevel(0); // start level
    }

    // --------------------------------------------------------
    // input utils
    const getMouseWorldPos = (event) =>{
        // Get mouse position in the world
        const rect = canvas.getBoundingClientRect();
        const mouseX = (event.clientX - rect.left) / SCALE;
        const mouseY = (canvas.height - (event.clientY - rect.top)) / SCALE;
        return Vec2(mouseX, mouseY);
    };

    const isPointOnBird = (point) =>{
        const birdPos = state.bird?.getPosition(); // Get bird position

        if(!birdPos) return false; // If there's not a position, return
        return Vec2.distance(birdPos, point) < BIRD_RADIUS; // return if the mouse is on the bird
    };

    // --------------------------------------------------------
    // Listeners

    canvas.addEventListener("mousedown", (e) =>{
        if(state.birdsRemaining <=0 || state.birdLaunched || !state.bird) return;

        const worldPos = getMouseWorldPos(e); // get mouse position in world

        if(isPointOnBird(worldPos)) {
            setState({isMouseDown: true, mousePos: worldPos});
        }
    });

    canvas.addEventListener("mousemove", (e) =>{
        if(!state.isMouseDown || !state.bird) return;

        const worldPos = getMouseWorldPos(e); // get mouse position in world
        const launchVector = Vec2.sub(state.bird.getPosition(), worldPos); // get launch vector

        // set state with mouse position and the launch vector
        setState({
            mousePos: worldPos,
            launchVector
        })
    })

    canvas.addEventListener("mouseup", () =>{
        if(!state.isMouseDown || !state.bird) return;

        const bird = state.bird; // get bird
        bird.setLinearVelocity(Vec2(0,0)); // set bird velocity to 0
        bird.setAngularVelocity(0); // set bird angular velocity to 0

        const impulse = state.launchVector.mul(5); // multiply launch vector by 5 to get the burds impulse

        bird.applyLinearImpulse(impulse, bird.getWorldCenter(), true); // apply linear impulse to the bird
        resetBirdTimers(); // reset bird timers

        // actualizate state with 1 less bird
        setState({
            isMouseDown: false,
            birdLaunched: true,
            birdsRemaining: state.birdsRemaining-1,
        });
    });

    // --------------------------------------------------------
    // Collision Logic
    const isGround = (body) => body === ground;

    world.on("post-solve", (contact, impulse) =>{
        if(!impulse) return;

        const fixtureA = contact.getFixtureA();
        const fixtureB = contact.getFixtureB();
        const bodyA = fixtureA.getBody();
        const bodyB = fixtureB.getBody();

        if(!(bodyA.isPig || bodyB.isPig)) return;

        const pigBody = bodyA.isPig ? bodyA : bodyB;
        const otherBody = bodyB.isPig ? bodyB : bodyA;

        if(isGround(otherBody)) return;

        const normalImpulse = impulse.normalImpulses?.[0] ?? 0;

        if(normalImpulse > 2.0){
            pigBody.isDestroyed = true;
        }
    });

    // --------------------------------------------------------
    // Update step
    const updateBirdTimers = () =>{
        const bird = state.bird; // get bird
        if(!state.birdLaunched || !bird) return;

        birdFlightTime += TIME_STEP; // increase flight time

        const speed = bird.getLinearVelocity().length(); // get bird speed
        const ang = Math.abs(bird.getAngularVelocity()); // get bird angular velocity

        if(speed < BIRD_STOP_SPEED && ang < BIRD_STOP_ANGULAR && !state.isMouseDown){
            birdIdleTime += TIME_STEP; // increase idle time
        } else{
            birdIdleTime = 0; // reset idle time
        }
    };

    const shouldRespawnBird = () =>{
        const bird = state.bird; // get bird
        if(!state.birdLaunched || !bird) return false;

        const pos = bird.getPosition(); // get bird position

        // check conditions for respawning bird
        const outRight = pos.x > 50;
        const outLow = pos.y < -10;
        const idleLongEnough = birdIdleTime >= BIRD_IDLE_SECONDS;
        const timedOut = birdFlightTime >= BIRD_MAX_FLIGHT_SECONDS;

        return outRight || outLow || idleLongEnough || timedOut; // return true if any condition is met
    };

    const handlePigsCleanup = () => {
        const remaining = state.pigs.filter(pig =>{ // filter pigs
            if(!pig.isDestroyed) return true; // if pig is not destroyed, keep it

            world.destroyBody(pig); // destroy pig body
            return false;
        });

        const removedCount = state.pigs.length - remaining.length; // calculate removed pigs

        if(removedCount > 0){ // if any pig was removed
            // update state with remaining pigs and increase score
            setState({
                pigs: remaining,
                score: state.score + removedCount * 100
            });
        }
    };

    const checkLevelComplete = () => {
        if(state.isLevelCompleted) return;
        if(state.pigs.length > 0) return;

        setState({isLevelCompleted: true});  // set level as completed

        if(!levelCompleteTimer){
            levelCompleteTimer = setTimeout(() =>{
                levelCompleteTimer = null;
                alert("Level complete");
                nextLevel();
            }, 500);
        }
    };

    const respawnBird = () =>{
        destroyBirdIfExists(); // destroy existing bird

        const bird = createBird(); // create new bird

        resetBirdTimers(); // reset bird timers

        // update state with new bird and reset launch state
        setState({
            bird,
            birdLaunched: false,
            isMouseDown: false,
            launchVector: Vec2(0,0)
        });
    };

    const handleBirdLifecycle = () =>{
        if(!shouldRespawnBird()) return;

        if(state.birdsRemaining > 0) { // if there are birds remaining
            respawnBird(); // respawn bird
            return;
        }

        if(!state.isLevelCompleted && !gameOverTimer) { // if level is not completed and there's no game over timer
            gameOverTimer = setTimeout(() =>{ // set game over timer
                gameOverTimer = null;
                alert("Game Over!");
                resetLevel();
            }, 500);
        }
    };

    const update = () =>{
        world.step(TIME_STEP, VELOCITY_ITERS, POSITION_ITERS); // step the physics world

        updateBirdTimers(); // update bird timers
        handlePigsCleanup(); // cleanup pigs
        checkLevelComplete();  // check if level is complete
        handleBirdLifecycle(); // handle bird lifecycle
    }

    // --------------------------------------------------------
    // Rendering
    const toCanvasY = (yMeters) => canvas.height - yMeters * SCALE;

    const drawnGround = () =>{
        ctx.beginPath();
        ctx.moveTo(0, toCanvasY(0));
        ctx.lineTo(canvas.width, toCanvasY(0));
        ctx.strokeStyle = "#290b50ff";
        ctx.lineWidth = 2;
        ctx.stroke();
    };

    const drawBoxes = () =>{
        state.boxes.forEach(box => {
            const position = box.getPosition(); // get box position
            const angle = box.getAngle(); // get box angle
            const shape = box.getFixtureList().getShape(); // get box shape
            const vertices = shape.m_vertices; // get box vertices

            ctx.save();
            ctx.translate(position.x * SCALE, toCanvasY(position.y));
            ctx.rotate(-angle);

            ctx.beginPath();
            ctx.moveTo(vertices[0].x * SCALE, -vertices[0].y * SCALE);

            // draw box shape
            for(let i =1; i<vertices.length; i++){
                ctx.lineTo(vertices[i].x * SCALE, -vertices[i].y * SCALE);
            }

            ctx.closePath();
            ctx.fillStyle = "#5c392dff";
            ctx.fill();
            ctx.restore();
        });
    };

    const drawDirt = () =>{
        state.dirts.forEach(dirt => {
            const position = dirt.getPosition(); // get dirt position
            const angle = dirt.getAngle(); // get dirt angle
            const shape = dirt.getFixtureList().getShape(); // get dirt shape
            const vertices = shape.m_vertices; // get dirt vertices

            ctx.save();
            ctx.translate(position.x * SCALE, toCanvasY(position.y)); // translate to dirt position
            ctx.rotate(-angle); // rotate to dirt angle

             // draw dirt shape

            ctx.beginPath();
            ctx.moveTo(vertices[0].x * SCALE, -vertices[0].y * SCALE);

            for(let i =1; i<vertices.length; i++){
                ctx.lineTo(vertices[i].x * SCALE, -vertices[i].y * SCALE);
            }

            ctx.closePath();
            ctx.fillStyle = "#d38d74ff";
            ctx.fill();
            ctx.restore();
        });
    };


    const drawRock = () =>{
        state.rocks.forEach(rock => {
            const position = rock.getPosition(); // get rock position
            const angle = rock.getAngle(); // get rock angle
            const shape = rock.getFixtureList().getShape(); // get rock shape
            const vertices = shape.m_vertices; // get rock vertices

            ctx.save();
            ctx.translate(position.x * SCALE, toCanvasY(position.y)); // translate to rock position
            ctx.rotate(-angle); // rotate to rock angle

            // draw rock shape
            ctx.beginPath();
            ctx.moveTo(vertices[0].x * SCALE, -vertices[0].y * SCALE);

            for(let i =1; i < vertices.length; i++){
                ctx.lineTo(vertices[i].x * SCALE, -vertices[i].y * SCALE);
            }

            ctx.closePath();
            ctx.fillStyle = "#848484ff";
            ctx.fill();
            ctx.restore();
        });
    };

    const drawCatapult = () =>{
        state.catapult.forEach(catapult => {
            const position = catapult.getPosition(); // get catapult position
            const angle = catapult.getAngle(); // get catapult angle
            const shape = catapult.getFixtureList().getShape(); // get catapult shape
            const vertices = shape.m_vertices; // get catapult vertices

            // draw catapult shape
            ctx.save();
            ctx.translate(position.x * SCALE, toCanvasY(position.y));
            ctx.rotate(-angle);

            ctx.beginPath();
            ctx.moveTo(vertices[0].x * SCALE, -vertices[0].y * SCALE);

            for(let i =1; i<vertices.length; i++){
                ctx.lineTo(vertices[i].x * SCALE, -vertices[i].y * SCALE);
            }

            ctx.closePath();
            ctx.fillStyle = "#7b7960ff";
            ctx.fill();
            ctx.restore();
        });
    };

    const drawPigs = () =>{
        state.pigs.forEach(pig =>{
            const position = pig.getPosition(); // get pig position
            const angle = pig.getAngle(); // get pig angle
            ctx.beginPath();

            // draw pig
            // posicion X, posicion Y, radio, angulo de inicio (0), angulo de fimal (360)
            ctx.arc(position.x * SCALE, toCanvasY(position.y), PIG_RADIUS * SCALE, 0, 2*Math.PI);
            ctx.fillStyle = '#117511ff';
            ctx.fill();
        });
    };

    const drawBird = () => {
        if(!state.bird) return; // if there's no bird, return
        const pos = state.bird.getPosition(); // get bird position

        // draw bird
        ctx.beginPath();
        ctx.arc(pos.x * SCALE, toCanvasY(pos.y), BIRD_RADIUS * SCALE, 0, Math.PI * 2);
        ctx.fillStyle = "#f44336";
        ctx.fill();
    };

    drawLaunchLine = () =>{
        if(!state.isMouseDown || !state.bird) return;
        const birdPos = state.bird.getPosition(); // get bird position

        // draw launch line
        ctx.beginPath();
        ctx.moveTo(birdPos.x * SCALE, toCanvasY(birdPos.y));
        ctx.lineTo(state.mousePos.x * SCALE, toCanvasY(state.mousePos.y));

        ctx.strokeStyle = "#9e9e9e";
        ctx.lineWidth = 2;
        ctx.stroke();
    };

    const drawHUD = () =>{
        ctx.fillStyle ="#000";
        ctx.font = "16px Arial";
        ctx.fillText(`Score: ${state.score}`, 10, 20);
        ctx.fillText(`Level: ${state.currentLevel}`, 10, 40);
        ctx.fillText(`Birds remaining: ${state.birdsRemaining}`, 10, 60);
    }

    const draw = () => {
        ctx.clearRect(0,0, canvas.width, canvas.height);

        // draw all game elements
        drawnGround();
        drawBoxes();
        drawCatapult();
        drawDirt();
        drawRock();
        drawPigs();
        drawBird();
        drawLaunchLine();
        drawHUD();
    };

    // --------------------------------------------------------
    // Game Loop
    const loop = () => {
        update();
        if (!LOADING) draw();
        requestAnimationFrame(loop);
    }

    initLevel(state.currentLevel).then(() => {
        loop();
    });
})();