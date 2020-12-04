/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
//import * as posenet from '@tensorflow-models/posenet';
//import dat from 'dat.gui';
//import Stats from 'stats.js';

//import {drawBoundingBox, drawKeypoints, drawSkeleton, isMobile, toggleLoadingUI, tryResNetButtonName, tryResNetButtonText, updateTryResNetButtonDatGuiCss} from './demo_util';

const videoWidth = 600;
const videoHeight = 500;
//const stats = new Stats();

/**
 * Loads a the camera to be used in the demo
 *
 */
async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      'Browser API navigator.mediaDevices.getUserMedia not available'
    );
  }

  const video = document.getElementById('video');
  video.width = videoWidth;
  video.height = videoHeight;

  const mobile = isMobile();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: mobile ? undefined : videoWidth,
      height: mobile ? undefined : videoHeight,
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function loadVideo() {
  const video = await setupCamera();
  video.play();

  return video;
}

const defaultQuantBytes = 2;

const defaultMobileNetMultiplier = isMobile() ? 0.5 : 0.75;
const defaultMobileNetStride = 16;
const defaultMobileNetInputResolution = 500;

const defaultResNetMultiplier = 1.0;
const defaultResNetStride = 32;
const defaultResNetInputResolution = 250;

const guiState = {
  algorithm: 'multi-pose',
  input: {
    architecture: 'MobileNetV1',
    outputStride: defaultMobileNetStride,
    inputResolution: defaultMobileNetInputResolution,
    multiplier: defaultMobileNetMultiplier,
    quantBytes: defaultQuantBytes,
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1,
    minPartConfidence: 0.5,
  },
  multiPoseDetection: {
    maxPoseDetections: 5,
    minPoseConfidence: 0.15,
    minPartConfidence: 0.1,
    nmsRadius: 30.0,
    angle: 0,
  },
  output: {
    showVideo: true,
    showSkeleton: true,
    showPoints: true,
    showBoundingBox: false,
  },
  net: null,
};

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras, net) {
  guiState.net = net;

  if (cameras.length > 0) {
    guiState.camera = cameras[0].deviceId;
  }

  const gui = new dat.GUI({ width: 300 });

  let architectureController = null;
  guiState[tryResNetButtonName] = function () {
    architectureController.setValue('ResNet50');
  };
  gui.add(guiState, tryResNetButtonName).name(tryResNetButtonText);
  updateTryResNetButtonDatGuiCss();

  // The single-pose algorithm is faster and simpler but requires only one
  // person to be in the frame or results will be innaccurate. Multi-pose works
  // for more than 1 person
  const algorithmController = gui.add(guiState, 'algorithm', [
    'single-pose',
    'multi-pose',
  ]);

  // The input parameters have the most effect on accuracy and speed of the
  // network
  let input = gui.addFolder('Input');
  // Architecture: there are a few PoseNet models varying in size and
  // accuracy. 1.01 is the largest, but will be the slowest. 0.50 is the
  // fastest, but least accurate.
  architectureController = input.add(guiState.input, 'architecture', [
    'MobileNetV1',
    'ResNet50',
  ]);
  guiState.architecture = guiState.input.architecture;
  // Input resolution:  Internally, this parameter affects the height and width
  // of the layers in the neural network. The higher the value of the input
  // resolution the better the accuracy but slower the speed.
  let inputResolutionController = null;
  function updateGuiInputResolution(inputResolution, inputResolutionArray) {
    if (inputResolutionController) {
      inputResolutionController.remove();
    }
    guiState.inputResolution = inputResolution;
    guiState.input.inputResolution = inputResolution;
    inputResolutionController = input.add(
      guiState.input,
      'inputResolution',
      inputResolutionArray
    );
    inputResolutionController.onChange(function (inputResolution) {
      guiState.changeToInputResolution = inputResolution;
    });
  }

  // Output stride:  Internally, this parameter affects the height and width of
  // the layers in the neural network. The lower the value of the output stride
  // the higher the accuracy but slower the speed, the higher the value the
  // faster the speed but lower the accuracy.
  let outputStrideController = null;
  function updateGuiOutputStride(outputStride, outputStrideArray) {
    if (outputStrideController) {
      outputStrideController.remove();
    }
    guiState.outputStride = outputStride;
    guiState.input.outputStride = outputStride;
    outputStrideController = input.add(
      guiState.input,
      'outputStride',
      outputStrideArray
    );
    outputStrideController.onChange(function (outputStride) {
      guiState.changeToOutputStride = outputStride;
    });
  }

  // Multiplier: this parameter affects the number of feature map channels in
  // the MobileNet. The higher the value, the higher the accuracy but slower the
  // speed, the lower the value the faster the speed but lower the accuracy.
  let multiplierController = null;
  function updateGuiMultiplier(multiplier, multiplierArray) {
    if (multiplierController) {
      multiplierController.remove();
    }
    guiState.multiplier = multiplier;
    guiState.input.multiplier = multiplier;
    multiplierController = input.add(
      guiState.input,
      'multiplier',
      multiplierArray
    );
    multiplierController.onChange(function (multiplier) {
      guiState.changeToMultiplier = multiplier;
    });
  }

  // QuantBytes: this parameter affects weight quantization in the ResNet50
  // model. The available options are 1 byte, 2 bytes, and 4 bytes. The higher
  // the value, the larger the model size and thus the longer the loading time,
  // the lower the value, the shorter the loading time but lower the accuracy.
  let quantBytesController = null;
  function updateGuiQuantBytes(quantBytes, quantBytesArray) {
    if (quantBytesController) {
      quantBytesController.remove();
    }
    guiState.quantBytes = +quantBytes;
    guiState.input.quantBytes = +quantBytes;
    quantBytesController = input.add(
      guiState.input,
      'quantBytes',
      quantBytesArray
    );
    quantBytesController.onChange(function (quantBytes) {
      guiState.changeToQuantBytes = +quantBytes;
    });
  }

  function updateGui() {
    if (guiState.input.architecture === 'MobileNetV1') {
      updateGuiInputResolution(defaultMobileNetInputResolution, [
        200,
        250,
        300,
        350,
        400,
        450,
        500,
        550,
        600,
        650,
        700,
        750,
        800,
      ]);
      updateGuiOutputStride(defaultMobileNetStride, [8, 16]);
      updateGuiMultiplier(defaultMobileNetMultiplier, [0.5, 0.75, 1.0]);
    } else {
      // guiState.input.architecture === "ResNet50"
      updateGuiInputResolution(defaultResNetInputResolution, [
        200,
        250,
        300,
        350,
        400,
        450,
        500,
        550,
        600,
        650,
        700,
        750,
        800,
      ]);
      updateGuiOutputStride(defaultResNetStride, [32, 16]);
      updateGuiMultiplier(defaultResNetMultiplier, [1.0]);
    }
    updateGuiQuantBytes(defaultQuantBytes, [1, 2, 4]);
  }

  updateGui();
  input.open();
  // Pose confidence: the overall confidence in the estimation of a person's
  // pose (i.e. a person detected in a frame)
  // Min part confidence: the confidence that a particular estimated keypoint
  // position is accurate (i.e. the elbow's position)
  let single = gui.addFolder('Single Pose Detection');
  single.add(guiState.singlePoseDetection, 'minPoseConfidence', 0.0, 1.0);
  single.add(guiState.singlePoseDetection, 'minPartConfidence', 0.0, 1.0);

  let multi = gui.addFolder('Multi Pose Detection');
  multi
    .add(guiState.multiPoseDetection, 'maxPoseDetections')
    .min(1)
    .max(20)
    .step(1);
  multi.add(guiState.multiPoseDetection, 'minPoseConfidence', 0.0, 1.0);
  multi.add(guiState.multiPoseDetection, 'minPartConfidence', 0.0, 1.0);
  // nms Radius: controls the minimum distance between poses that are returned
  // defaults to 20, which is probably fine for most use cases
  multi.add(guiState.multiPoseDetection, 'nmsRadius').min(0.0).max(40.0);
  multi.open();

  let output = gui.addFolder('Output');
  output.add(guiState.output, 'showVideo');
  output.add(guiState.output, 'showSkeleton');
  output.add(guiState.output, 'showPoints');
  output.add(guiState.output, 'showBoundingBox');
  output.open();

  architectureController.onChange(function (architecture) {
    // if architecture is ResNet50, then show ResNet50 options
    updateGui();
    guiState.changeToArchitecture = architecture;
  });

  algorithmController.onChange(function (value) {
    switch (guiState.algorithm) {
      case 'single-pose':
        multi.close();
        single.open();
        break;
      case 'multi-pose':
        single.close();
        multi.open();
        break;
    }
  });
}

/**
 * Sets up a frames per second panel on the top-left of the window
 */
//function setupFPS() {
//  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
//  document.getElementById('main').appendChild(stats.dom);
//}

/**
 * Feeds an image to posenet to estimate poses - this is where the magic
 * happens. This function loops with a requestAnimationFrame method.
 */
function detectPoseInRealTime(video, net) {
  const canvas = document.getElementById('output');
  const ctx = canvas.getContext('2d');

  // since images are being fed from a webcam, we want to feed in the
  // original image and then just flip the keypoints' x coordinates. If instead
  // we flip the image, then correcting left-right keypoint pairs requires a
  // permutation on all the keypoints.
  const flipPoseHorizontal = true;

  canvas.width = videoWidth;
  canvas.height = videoHeight;

  async function poseDetectionFrame() {
    if (guiState.changeToArchitecture) {
      // Important to purge variables and free up GPU memory
      guiState.net.dispose();
      toggleLoadingUI(true);
      guiState.net = await posenet.load({
        architecture: guiState.changeToArchitecture,
        outputStride: guiState.outputStride,
        inputResolution: guiState.inputResolution,
        multiplier: guiState.multiplier,
      });
      toggleLoadingUI(false);
      guiState.architecture = guiState.changeToArchitecture;
      guiState.changeToArchitecture = null;
    }

    if (guiState.changeToMultiplier) {
      guiState.net.dispose();
      toggleLoadingUI(true);
      guiState.net = await posenet.load({
        architecture: guiState.architecture,
        outputStride: guiState.outputStride,
        inputResolution: guiState.inputResolution,
        multiplier: +guiState.changeToMultiplier,
        quantBytes: guiState.quantBytes,
      });
      toggleLoadingUI(false);
      guiState.multiplier = +guiState.changeToMultiplier;
      guiState.changeToMultiplier = null;
    }

    if (guiState.changeToOutputStride) {
      // Important to purge variables and free up GPU memory
      guiState.net.dispose();
      toggleLoadingUI(true);
      guiState.net = await posenet.load({
        architecture: guiState.architecture,
        outputStride: +guiState.changeToOutputStride,
        inputResolution: guiState.inputResolution,
        multiplier: guiState.multiplier,
        quantBytes: guiState.quantBytes,
      });
      toggleLoadingUI(false);
      guiState.outputStride = +guiState.changeToOutputStride;
      guiState.changeToOutputStride = null;
    }

    if (guiState.changeToInputResolution) {
      // Important to purge variables and free up GPU memory
      guiState.net.dispose();
      toggleLoadingUI(true);
      guiState.net = await posenet.load({
        architecture: guiState.architecture,
        outputStride: guiState.outputStride,
        inputResolution: +guiState.changeToInputResolution,
        multiplier: guiState.multiplier,
        quantBytes: guiState.quantBytes,
      });
      toggleLoadingUI(false);
      guiState.inputResolution = +guiState.changeToInputResolution;
      guiState.changeToInputResolution = null;
    }

    if (guiState.changeToQuantBytes) {
      // Important to purge variables and free up GPU memory
      guiState.net.dispose();
      toggleLoadingUI(true);
      guiState.net = await posenet.load({
        architecture: guiState.architecture,
        outputStride: guiState.outputStride,
        inputResolution: guiState.inputResolution,
        multiplier: guiState.multiplier,
        quantBytes: guiState.changeToQuantBytes,
      });
      toggleLoadingUI(false);
      guiState.quantBytes = guiState.changeToQuantBytes;
      guiState.changeToQuantBytes = null;
    }

    // Begin monitoring code for frames per second
    //stats.begin();

    let poses = [];
    let minPoseConfidence;
    let minPartConfidence;
    switch (guiState.algorithm) {
      case 'single-pose':
        const pose = await guiState.net.estimatePoses(video, {
          flipHorizontal: flipPoseHorizontal,
          decodingMethod: 'single-person',
        });
        poses = poses.concat(pose);
        minPoseConfidence = +guiState.singlePoseDetection.minPoseConfidence;
        minPartConfidence = +guiState.singlePoseDetection.minPartConfidence;
        break;
      case 'multi-pose':
        let all_poses = await guiState.net.estimatePoses(video, {
          flipHorizontal: flipPoseHorizontal,
          decodingMethod: 'multi-person',
          maxDetections: guiState.multiPoseDetection.maxPoseDetections,
          scoreThreshold: guiState.multiPoseDetection.minPartConfidence,
          nmsRadius: guiState.multiPoseDetection.nmsRadius,
         // angle: guiState.multiPoseDetection.shoulderModelAngleR,
        });

        poses = poses.concat(all_poses);
        minPoseConfidence = +guiState.multiPoseDetection.minPoseConfidence;
        minPartConfidence = +guiState.multiPoseDetection.minPartConfidence;
        break;
    }

    ctx.clearRect(0, 0, videoWidth, videoHeight);

    if (guiState.output.showVideo) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-videoWidth, 0);
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
      ctx.restore();
    }

    // For each pose (i.e. person) detected in an image, loop through the poses
    // and draw the resulting skeleton and keypoints if over certain confidence
    // scores
    poses.forEach(({ score, keypoints }) => {
      if (score >= minPoseConfidence) {
        if (guiState.output.showPoints) {
          drawKeypoints(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showSkeleton) {
          drawSkeleton(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showBoundingBox) {
          drawBoundingBox(keypoints, ctx);
        }
      }
      // console.log("getting keypoints score");
      // console.log(keypoints);

      //calculate the distance here
      //measure one pose - starting position
      // console.log("calculate similarity")
      // var noseX1 = 348.45116403780094;
      // var noseY1= 85.56370538496321;
      // var leftShoulderX = 442.6869638049649;
      // var leftShoulderY = 174.2667611563716;
      // var rightShoulderX = 216.47451675355666;
      // var rightShoulderY = 182.14048155550825;
      // var leftElbowX = 523.0347047798365;
      // var leftElbowY = 306.81460369421814;
      // var rightElbowX = 126.17579597443458;
      // var rightElbowY = 306.89585407420356;
      // var leftWristX = 522.177275447623;
      // var leftWristY = 402.04418256588946;
      // var rightWristX = 107.853321119969;
      // var rightWristY = 379.3897196847641;

      // from mozilla dev how to access json in javascript
      //now can access the poses, have to host the json in local server

      let requestURL = 'http://localhost:3000/startPose.jpg';
      let request = new XMLHttpRequest();
      request.open('GET', requestURL);
      request.responseType = 'json';
      request.send();

      request.onload = function () {
        const mydata = request.response;
        console.log(mydata);

        //calculate distance between model and live feed keypoints
        var noseDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[0].position.x - keypoints[0].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[0].position.y - keypoints[0].position.y,
              2
            )
        );
        var leftEyeDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[1].position.x - keypoints[1].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[1].position.y - keypoints[1].position.y,
              2
            )
        );
        var rightEyeDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[2].position.x - keypoints[2].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[2].position.y - keypoints[2].position.y,
              2
            )
        );
        var leftEarDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[3].position.x - keypoints[3].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[3].position.y - keypoints[3].position.y,
              2
            )
        );
        var rightEarDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[4].position.x - keypoints[4].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[4].position.y - keypoints[4].position.y,
              2
            )
        );
        var leftShouderDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[5].position.x - keypoints[5].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[5].position.y - keypoints[5].position.y,
              2
            )
        );
        var rightShouderDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[6].position.x - keypoints[6].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[6].position.y - keypoints[6].position.y,
              2
            )
        );
        var leftElbowDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[7].position.x - keypoints[7].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[7].position.y - keypoints[7].position.y,
              2
            )
        );
        var rightElbowDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[8].position.x - keypoints[8].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[8].position.y - keypoints[8].position.y,
              2
            )
        );
        var lefttWristDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[9].position.x - keypoints[9].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[9].position.y - keypoints[9].position.y,
              2
            )
        );
        var rightWristDistace = Math.sqrt(
          Math.pow(
            mydata.keypoints[10].position.x - keypoints[10].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[10].position.y - keypoints[10].position.y,
              2
            )
        );

        /*
        console.log('nose score is' + noseDistace);
        console.log('left eye score is' + leftEyeDistace);
        console.log('right eye score is' + rightEyeDistace);
        console.log('left ear score is' + leftEarDistace);
        console.log('right ear score is' + rightEarDistace);
        console.log('left Shoulder score is' + leftShouderDistace);
        console.log('right Shoulder score is' + rightShouderDistace);
        console.log('left elbow score is ' + leftElbowDistace);
        console.log('right elbow score is' + rightElbowDistace);
        console.log('left Wrist score is' + lefttWristDistace);
        console.log('right Wrist score is' + rightWristDistace);

        */

        // calculate accuracy based on the distance
        //find max distance

        /* 
        //estimate cosine angle between two joints in the skeleton
        function find_angle(p0,p1,c) {
          var p0c = Math.sqrt(Math.pow(c.x-p0.x,2)+
                              Math.pow(c.y-p0.y,2)); // p0->c (b)   
          var p1c = Math.sqrt(Math.pow(c.x-p1.x,2)+
                              Math.pow(c.y-p1.y,2)); // p1->c (a)
          var p0p1 = Math.sqrt(Math.pow(p1.x-p0.x,2)+
                               Math.pow(p1.y-p0.y,2)); // p0->p1 (c)
          return Math.acos((p1c*p1c+p0c*p0c-p0p1*p0p1)/(2*p1c*p0c));
      }
      */

        //p0 = right shoulder. 6
        //p1 = right wrist. 10
        //c = right elbow. 8
        // calculating the cosine angle using atan2

        const rightElbowModelX = mydata.keypoints[8].position.x; //knee
        const rightShoulderModelX = mydata.keypoints[6].position.x; //hip
        const rightWristModelX = mydata.keypoints[10].position.x; //ankle
        const rightElbowModelY = mydata.keypoints[8].position.y; //knee
        const rightShoulderModelY = mydata.keypoints[6].position.y; //hip
        const rightWristModelY = mydata.keypoints[10].position.y; //ankle

        /*
        //left hand

        //calculate angle model right using tangen return angle in radian
        const rightArmAngle =
          (Math.atan2(
            rightWristModelY - rightElbowModelY,
            rightWristModelX - rightElbowModelX
          ) -
            Math.atan2(
              rightShoulderModelY - rightElbowModelY,
              rightShoulderModelX - rightElbowModelX
            )) *
          (180 / Math.PI);

        console.log('right arm angle ' + rightArmAngle);

        //calculate angle using math acos right arm
        const shoulderModelX = mydata.keypoints[6].position.x;
        const elbowModelX = mydata.keypoints[8].position.x;
        const wristModelX = mydata.keypoints[10].position.x;
        const shoulderModelY = mydata.keypoints[6].position.y;
        const elbowModelY = mydata.keypoints[8].position.y;
        const wristModelY = mydata.keypoints[10].position.y;

        const shoulderElbow = Math.sqrt(
          Math.pow(
            mydata.keypoints[6].position.x - mydata.keypoints[8].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[6].position.y - mydata.keypoints[8].position.y,
              2
            )
        );
        const elbowWrist = Math.sqrt(
          Math.pow(
            mydata.keypoints[8].position.x - mydata.keypoints[10].position.x,
            2
          ) +
            Math.pow(
              mydata.keypoints[8].position.y - mydata.keypoints[10].position.y,
              2
            )
        );

        const armAngle =
          Math.atan2(shoulderElbow, elbowWrist) * (180 / Math.PI);

      
        console.log('test arm angle using atan the degree is ' + armAngle);
        */

        //testing another formula
        //suitable with cosine law //use this

        //right arm

        const shoulder = {
          x: mydata.keypoints[6].position.x,
          y: mydata.keypoints[6].position.y,
        };

        const elbow = {
          x: mydata.keypoints[8].position.x,
          y: mydata.keypoints[8].position.y,
        };

        const wrist = {
          x: mydata.keypoints[10].position.x,
          y: mydata.keypoints[10].position.y,
        };

        var sE = Math.sqrt(
          Math.pow(shoulder.x - elbow.x, 2) + Math.pow(shoulder.y - elbow.y, 2)
        );
        var eW = Math.sqrt(
          Math.pow(elbow.x - wrist.x, 2) + Math.pow(elbow.y - wrist.y, 2)
        );
        var sW = Math.sqrt(
          Math.pow(shoulder.x - wrist.x, 2) + Math.pow(shoulder.y - wrist.y, 2)
        );
        //angle in radian

        var resultRadian = Math.acos(
          (Math.pow(sE, 2) + Math.pow(eW, 2) - Math.pow(sW, 2)) / (2 * sE * eW)
        );

        console.log('the right arm is moving on' + resultRadian + ' radian');

        //angle in degree
        var resultDegree =
          (Math.acos(
            (Math.pow(sE, 2) + Math.pow(eW, 2) - Math.pow(sW, 2)) /
              (2 * sE * eW)
          ) *
            180) /
          Math.PI;

        console.log('the right arm is moving on ' + resultDegree + ' degree');

        //left elbow angle

        const leftShoulder = {
          x: mydata.keypoints[5].position.x,
          y: mydata.keypoints[5].position.y,
        };

        const leftElbow = {
          x: mydata.keypoints[7].position.x,
          y: mydata.keypoints[7].position.y,
        };

        const leftWrist = {
          x: mydata.keypoints[9].position.x,
          y: mydata.keypoints[9].position.y,
        };

        var leftSE = Math.sqrt(
          Math.pow(leftShoulder.x - leftElbow.x, 2) +
            Math.pow(leftShoulder.y - leftElbow.y, 2)
        );
        var leftEW = Math.sqrt(
          Math.pow(leftElbow.x - leftWrist.x, 2) +
            Math.pow(leftElbow.y - leftWrist.y, 2)
        );
        var leftSW = Math.sqrt(
          Math.pow(leftShoulder.x - leftWrist.x, 2) +
            Math.pow(leftShoulder.y - leftWrist.y, 2)
        );
        //angle in radian

        var resultRadianLeft = Math.acos(
          (Math.pow(leftSE, 2) + Math.pow(leftEW, 2) - Math.pow(leftSW, 2)) /
            (2 * leftSE * leftEW)
        );

        console.log('the left arm is moving on' + resultRadian + ' radian');

        //angle in degree
        var resultDegreeLeft =
          (Math.acos(
            (Math.pow(leftSE, 2) + Math.pow(leftEW, 2) - Math.pow(leftSW, 2)) /
              (2 * leftSE * leftEW)
          ) *
            180) /
          Math.PI;

        console.log(
          'the left arm is moving on ' + resultDegreeLeft + ' degree'
        );

        //calculate the percentage of target vs live

        //live angle
        const liveLeftShoulder = {
          x: keypoints[5].position.x,
          y: keypoints[5].position.y,
        };

        const liveLeftElbow = {
          x: keypoints[7].position.x,
          y: keypoints[7].position.y,
        };

        const liveLeftWrist = {
          x: keypoints[9].position.x,
          y: keypoints[9].position.y,
        };

        var liveLeftSE = Math.sqrt(
          Math.pow(liveLeftShoulder.x - liveLeftElbow.x, 2) +
            Math.pow(liveLeftShoulder.y - liveLeftElbow.y, 2)
        );
        var liveLeftEW = Math.sqrt(
          Math.pow(liveLeftElbow.x - liveLeftWrist.x, 2) +
            Math.pow(liveLeftElbow.y - liveLeftWrist.y, 2)
        );
        var liveLeftSW = Math.sqrt(
          Math.pow(liveLeftShoulder.x - liveLeftWrist.x, 2) +
            Math.pow(liveLeftShoulder.y - liveLeftWrist.y, 2)
        );
        //angle in radian

        var resultRadianLeftLive = Math.acos(
          (Math.pow(liveLeftSE, 2) +
            Math.pow(liveLeftEW, 2) -
            Math.pow(liveLeftSW, 2)) /
            (2 * liveLeftSE * liveLeftEW)
        );

        console.log(
          'the live left arm is moving on' + resultRadianLeftLive + ' radian'
        );

        //angle in degree
        var resultDegreeLeftLive =
          (Math.acos(
            (Math.pow(liveLeftSE, 2) +
              Math.pow(liveLeftEW, 2) -
              Math.pow(liveLeftSW, 2)) /
              (2 * liveLeftSE * liveLeftEW)
          ) *
            180) /
          Math.PI;

        console.log(
          'the live left arm is moving on ' + resultDegreeLeftLive + ' degree'
        );

        //live right shoulder

        const liveRightShoulder = {
          x: keypoints[6].position.x,
          y: keypoints[6].position.y,
        };

        const liveRightElbow = {
          x: keypoints[8].position.x,
          y: keypoints[8].position.y,
        };

        const liveRightWrist = {
          x: keypoints[10].position.x,
          y: keypoints[10].position.y,
        };

        var liveRightSE = Math.sqrt(
          Math.pow(liveRightShoulder.x - liveRightElbow.x, 2) +
            Math.pow(liveRightShoulder.y - liveRightElbow.y, 2)
        );
        var liveRightEW = Math.sqrt(
          Math.pow(liveRightElbow.x - liveRightWrist.x, 2) +
            Math.pow(liveRightElbow.y - liveRightWrist.y, 2)
        );
        var liveRightSW = Math.sqrt(
          Math.pow(liveRightShoulder.x - liveRightWrist.x, 2) +
            Math.pow(liveRightShoulder.y - liveRightWrist.y, 2)
        );
        //angle in radian

        var resultRadianRightLive = Math.acos(
          (Math.pow(liveRightSE, 2) +
            Math.pow(liveRightEW, 2) -
            Math.pow(liveRightSW, 2)) /
            (2 * liveRightSE * liveRightEW)
        );

        console.log(
          'the live left arm is moving on' + resultRadianRightLive + ' radian'
        );

        //angle in degree
        var resultDegreeRightLive =
          (Math.acos(
            (Math.pow(liveRightSE, 2) +
              Math.pow(liveRightEW, 2) -
              Math.pow(liveRightSW, 2)) /
              (2 * liveRightSE * liveRightEW)
          ) *
            180) /
          Math.PI;

        console.log(
          'the live left arm is moving on ' + resultDegreeRightLive + ' degree'
        );

        //SHOULDER angle
        //model right

        //try using function
        //result in NaN
        //live angle
        /*
        function shoulderModelAngle(Ex, Ey, Sx, Sy, Hx, Hy) {
          const modelES = Math.sqrt(
            Math.pow(Ex - Sx, 2) + Math.pow(Ey - Sy, 2)
          );
          const modelSH = Math.sqrt(
            Math.pow(Sx - Hx, 2) + Math.pow(Sy - Hy, 2)
          );
          const modelEH = Math.sqrt(
            Math.pow(Ex - Hx, 2) + Math.pow(Ey - Hy, 2)
          );

          return Math.acos(
            modelES * modelES +
              modelSH * modelSH -
              (modelEH * modelES) / (2 * modelES * modelSH)
          );
        }

        const testangle = shoulderModelAngle(
          mydata.keypoints[8].position.x,
          mydata.keypoints[8].position.y,
          mydata.keypoints[6].position.x,
          mydata.keypoints[6].position.y,
          mydata.keypoints[12].position.x,
          mydata.keypoints[12].position.y
        );

        console.log('test function right angle position is ' + testangle); //result in NaN ..something is typed wrong

        */

        function find_radian(Ax, Ay, Bx, By, Cx, Cy) {
          const AB = Math.sqrt(Math.pow(Bx - Ax, 2) + Math.pow(By - Ay, 2));
          const BC = Math.sqrt(Math.pow(Bx - Cx, 2) + Math.pow(By - Cy, 2));
          const AC = Math.sqrt(Math.pow(Cx - Ax, 2) + Math.pow(Cy - Ay, 2));

          return Math.acos(
            (BC * BC + AB * AB - AC * AC) / (2 * BC * AB * (180 / Math.PI))
          );
        }
        const shoulderModelRadianR = find_radian(
          mydata.keypoints[8].position.x,
          mydata.keypoints[8].position.y,
          mydata.keypoints[6].position.x,
          mydata.keypoints[6].position.y,
          mydata.keypoints[12].position.x,
          mydata.keypoints[12].position.y
        );

        const shoulderModelAngleR = shoulderModelRadianR * (180 / Math.PI);

        console.log(
          'right shoulder radian in the model is ' + shoulderModelRadianR
        );
        console.log(
          ' right shoulder angle in the model is ' + shoulderModelAngleR
        );

        //

        //model left

        const shoulderModelRadianL = find_radian(
          mydata.keypoints[7].position.x, // left elbow
          mydata.keypoints[7].position.y,
          mydata.keypoints[5].position.x, //left shoulder
          mydata.keypoints[5].position.y,
          mydata.keypoints[11].position.x, // lefthip
          mydata.keypoints[11].position.y
        );

        const shoulderModelAngleL = shoulderModelRadianL * (180 / Math.PI);

        console.log(
          'left shoulder radian in the model is ' + shoulderModelRadianL
        );
        console.log(
          'left shoulder angle in the model is ' + shoulderModelAngleL
        );

        //live right
        const shoulderLiveRadianR = find_radian(
          keypoints[8].position.x, //right elbow
          keypoints[8].position.y,
          keypoints[6].position.x, //right shoulder
          keypoints[6].position.y,
          keypoints[12].position.x, //right hip
          keypoints[12].position.y
        );

        const shoulderLiveAngleR = shoulderLiveRadianR * (180 / Math.PI);

        console.log('right shoulder radian live is ' + shoulderLiveRadianR);
        console.log('right shoulder angle live is ' + shoulderLiveAngleR);
        //live left
        const shoulderLiveRadianL = find_radian(
          keypoints[7].position.x, // left elbow
          keypoints[7].position.y,
          keypoints[5].position.x, //left shoulder
          keypoints[5].position.y,
          keypoints[11].position.x, // lefthip
          keypoints[11].position.y
        );

        const shoulderLiveAngleL = shoulderLiveRadianL * (180 / Math.PI);

        console.log('left shoulder radian live  is ' + shoulderLiveRadianL);
        console.log('left shoulder angle live is ' + shoulderLiveAngleL);

        // inward outward

        // how to know the pose match?
        //target angle vs live angle
        console.log('target left shoulder angle is ' + shoulderModelAngleL); //Right shoulder model
        console.log('while live left shoulder angle is ' + shoulderLiveAngleR); //right shoulder live

        console.log('target right shoulder angle is ' + shoulderModelAngleR);
        console.log('while live left shoulder angle is ' + shoulderLiveAngleL);

        console.log('target left elbow angle is ' + resultDegreeLeft);
        console.log('while live left elbow angle is ' + resultDegreeLeftLive);

        console.log('target right elbow angle is ' + resultDegree);
        console.log('while live right elbow angle is ' + resultDegreeRightLive);

        //display on UI

        //calling model pose keypoints
      };
    });

    

    // End monitoring code for frames per second
    //stats.end();

    requestAnimationFrame(poseDetectionFrame);
  }

  poseDetectionFrame();
}

/**
 * Kicks off the demo by loading the posenet model, finding and loading
 * available camera devices, and setting off the detectPoseInRealTime function.
 */
async function bindPage() {
  toggleLoadingUI(true);
  const net = await posenet.load({
    architecture: guiState.input.architecture,
    outputStride: guiState.input.outputStride,
    inputResolution: guiState.input.inputResolution,
    multiplier: guiState.input.multiplier,
    quantBytes: guiState.input.quantBytes,
  });
  toggleLoadingUI(false);

  let video;

  try {
    video = await loadVideo();
  } catch (e) {
    let info = document.getElementById('info');
    info.textContent =
      'this browser does not support video capture,' +
      'or this device does not have a camera';
    info.style.display = 'block';
    throw e;
  }

  setupGui([], net);
  //setupFPS();  // dont need STATS.js
  detectPoseInRealTime(video, net);
}

navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia;
// kick off the demo

bindPage();
