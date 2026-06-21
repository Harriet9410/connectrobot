#!/bin/bash
# WebRop 全功能启动脚本
# 在小车端运行: chmod +x webrop_full_launch.sh && ./webrop_full_launch.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        WebRop 全功能启动脚本                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}请选择传感器类型:${NC}"
echo -e "  ${GREEN}1)${NC} 2D 激光雷达 (RPLidar / Hokuyo)"
echo -e "  ${GREEN}2)${NC} Azure Kinect DK (深度相机)"
echo -e "  ${GREEN}3)${NC} Intel RealSense (深度相机)"
echo ""
read -p "输入选择 [1/2/3]: " SENSOR_CHOICE

echo ""
echo -e "${YELLOW}请选择 SLAM 方法:${NC}"
echo -e "  ${GREEN}1)${NC} GMapping   — 2D粒子滤波，需里程计"
echo -e "  ${GREEN}2)${NC} Cartographer — Google图优化"
echo -e "  ${GREEN}3)${NC} Hector SLAM — 无需里程计"
echo -e "  ${GREEN}4)${NC} RTAB-Map   — RGB-D视觉SLAM"
echo ""
read -p "输入选择 [1/2/3/4]: " SLAM_CHOICE

echo ""
echo -e "${YELLOW}是否启动导航栈 (move_base + amcl)?${NC}"
echo -e "  航点导航、重定位功能需要"
read -p "启动导航? [y/n]: " NAV_CHOICE

echo ""
echo -e "${YELLOW}是否有电池驱动?${NC}"
read -p "启动电池监听? [y/n]: " BATT_CHOICE

echo ""
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}正在启动所有终端...${NC}"
echo -e "${CYAN}════════════════════════════════════════════════${NC}"

# ── 终端1: roscore ──
echo -e "${GREEN}[启动]${NC} 终端1: roscore (ROS核心)"
gnome-terminal --title="WebRop - roscore" -- bash -c "source /opt/ros/noetic/setup.bash; roscore; exec bash" &
sleep 2

# ── 终端2: 相机驱动 (深度相机才需要) ──
if [ "$SENSOR_CHOICE" = "2" ]; then
  echo -e "${GREEN}[启动]${NC} 终端2: Azure Kinect 驱动 (发布 /camera/rgb, /camera/depth)"
  gnome-terminal --title="WebRop - Kinect Driver" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch azure_kinect_ros_driver driver.launch depth_mode:=NFOV_UNBINNED color_resolution:=720P fps:=15; exec bash" &
  sleep 3
elif [ "$SENSOR_CHOICE" = "3" ]; then
  echo -e "${GREEN}[启动]${NC} 终端2: RealSense 驱动 (发布 /camera/rgb, /camera/depth)"
  gnome-terminal --title="WebRop - RealSense Driver" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch realsense2_camera rs_camera.launch depth_module.profile:=640x480x15 color_module.profile:=640x480x15 enable_sync:=true; exec bash" &
  sleep 3
fi

# ── 终端3: 深度图转 LaserScan (深度相机才需要) ──
if [ "$SENSOR_CHOICE" = "2" ] || [ "$SENSOR_CHOICE" = "3" ]; then
  echo -e "${GREEN}[启动]${NC} 终端3: depthimage_to_laserscan (深度图→/scan)"
  gnome-terminal --title="WebRop - Depth to LaserScan" -- bash -c "source /opt/ros/noetic/setup.bash; rosrun depthimage_to_laserscan depthimage_to_laserscan image:=/camera/depth/image_raw camera_info:=/camera/depth/camera_info range_min:=0.45 range_max:=8.0 scan_height:=20 output_frame_id:=camera_depth_frame; exec bash" &
  sleep 1
fi

# ── 终端4: 里程计 ──
if [ "$SLAM_CHOICE" != "4" ]; then
  if [ "$SENSOR_CHOICE" != "1" ]; then
    echo -e "${GREEN}[启动]${NC} 终端: rf2o_laser_odometry (扫描匹配里程计)"
    gnome-terminal --title="WebRop - Odometry (rf2o)" -- bash -c "source /opt/ros/noetic/setup.bash; rosrun rf2o_laser_odometry rf2o_laser_odometry_node laser_scan_topic:=/scan odom_topic:=/rf2o_odom base_frame_id:=base_link odom_frame_id:=odom freq:=15; exec bash" &
    sleep 1
  else
    echo -e "${YELLOW}[跳过]${NC} 里程计 — 使用轮式里程计(小车自带)"
  fi
fi

# ── 终端5: TF 静态变换 (深度相机才需要) ──
if [ "$SENSOR_CHOICE" = "2" ] || [ "$SENSOR_CHOICE" = "3" ]; then
  echo -e "${GREEN}[启动]${NC} 终端: base_link → camera_link TF"
  gnome-terminal --title="WebRop - TF (base→camera)" -- bash -c "source /opt/ros/noetic/setup.bash; rosrun tf static_transform_publisher 0 0 0.5 0 0 0 base_link camera_link 100; exec bash" &
  sleep 1
fi

# ── 终端6: SLAM ──
case $SLAM_CHOICE in
  1)
    echo -e "${GREEN}[启动]${NC} 终端: GMapping SLAM (发布 /map)"
    gnome-terminal --title="WebRop - GMapping" -- bash -c "source /opt/ros/noetic/setup.bash; rosrun gmapping slam_gmapping _delta:=0.3 _linearUpdate:=0.2 _angularUpdate:=0.15 _maxUrange:=8.0 _resolution:=0.05; exec bash" &
    ;;
  2)
    echo -e "${GREEN}[启动]${NC} 终端: Cartographer SLAM (发布 /map)"
    gnome-terminal --title="WebRop - Cartographer" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch cartographer_ros cartographer_demo.lua; exec bash" &
    ;;
  3)
    echo -e "${GREEN}[启动]${NC} 终端: Hector SLAM (发布 /map, 无需里程计)"
    gnome-terminal --title="WebRop - Hector SLAM" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch hector_slam_launch mapping_default.launch; exec bash" &
    ;;
  4)
    echo -e "${GREEN}[启动]${NC} 终端: RTAB-Map SLAM (发布 /map, 自带视觉里程计)"
    if [ "$SENSOR_CHOICE" = "1" ]; then
      gnome-terminal --title="WebRop - RTAB-Map" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch rtabmap_ros rtabmap.launch rtabmap_args:='--delete_db_on_start' scan_topic:=/scan; exec bash" &
    else
      gnome-terminal --title="WebRop - RTAB-Map" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch rtabmap_ros rtabmap.launch rtabmap_args:='--delete_db_on_start' rgb_topic:=/camera/rgb/image_raw depth_topic:=/camera/depth/image_raw camera_info_topic:=/camera/rgb/camera_info scan_topic:=/scan visual_odometry:=true approx_sync:=true; exec bash" &
    fi
    ;;
esac
sleep 2

# ── 终端7: move_base 导航栈 ──
if [ "$NAV_CHOICE" = "y" ] || [ "$NAV_CHOICE" = "Y" ]; then
  echo -e "${GREEN}[启动]${NC} 终端: move_base (航点导航)"
  gnome-terminal --title="WebRop - move_base" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch move_base move_base.launch; exec bash" &
  sleep 1

  echo -e "${GREEN}[启动]${NC} 终端: AMCL (重定位功能)"
  gnome-terminal --title="WebRop - AMCL" -- bash -c "source /opt/ros/noetic/setup.bash; rosrun amcl amcl; exec bash" &
  sleep 1
fi

# ── 终端8: 电池监听 ──
if [ "$BATT_CHOICE" = "y" ] || [ "$BATT_CHOICE" = "Y" ]; then
  echo -e "${GREEN}[启动]${NC} 终端: 电池状态发布 (/battery_state)"
  gnome-terminal --title="WebRop - Battery" -- bash -c "source /opt/ros/noetic/setup.bash; python3 ${SCRIPT_DIR}/battery_publisher.py; exec bash" &
  sleep 1
fi

# ── 终端9: rosbridge (最后启动，确保其他节点就绪) ──
echo -e "${GREEN}[启动]${NC} 终端: rosbridge_server (网页连接端口9090)"
gnome-terminal --title="WebRop - rosbridge (9090)" -- bash -c "source /opt/ros/noetic/setup.bash; roslaunch rosbridge_server rosbridge_websocket_launch.launch port:=9090; exec bash" &
sleep 2

echo ""
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ 所有终端已启动！${NC}"
echo -e "${CYAN}════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}网站功能对照表:${NC}"
echo -e "  ${GREEN}●${NC} ROS 连接        — rosbridge (端口9090)"
echo -e "  ${GREEN}●${NC} SLAM 建图        — SLAM 节点 (发布 /map)"
echo -e "  ${GREEN}●${NC} 激光扫描可视化   — /scan 话题"
echo -e "  ${GREEN}●${NC} 摄像头画面       — /camera/rgb/image_raw/compressed"
echo -e "  ${GREEN}●${NC} WASD 遥控        — /cmd_vel"
echo -e "  ${GREEN}●${NC} 航点导航         — move_base"
echo -e "  ${GREEN}●${NC} 重定位           — AMCL (/initialpose)"
echo -e "  ${GREEN}●${NC} 保存地图         — 前端直接下载 PGM+YAML"
echo -e "  ${GREEN}●${NC} 电池显示         — /battery_state"
echo ""
echo -e "${YELLOW}在浏览器打开网站，输入:${NC}"
echo -e "  ${CYAN}ws://$(hostname -I | awk '{print $1}'):9090${NC}"
echo ""
echo -e "${RED}按 Ctrl+C 不会关闭已开终端，请手动关闭各终端窗口${NC}"
read -p "按回车退出此脚本..."
