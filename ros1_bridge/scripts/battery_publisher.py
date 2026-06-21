#!/usr/bin/env python3
"""
发布 /battery_state 话题，供 WebRop 网页显示电量。
如果有真实电池驱动，可替换为实际驱动节点。
用法: python3 battery_publisher.py
"""
import rospy
from sensor_msgs.msg import BatteryState

def main():
    rospy.init_node('webrop_battery_publisher', anonymous=True)
    pub = rospy.Publisher('/battery_state', BatteryState, queue_size=1)
    rate = rospy.Rate(0.2)

    voltage = rospy.get_param('~voltage', 12.0)
    percentage = rospy.get_param('~percentage', 0.85)

    rospy.loginfo('Battery publisher started: %.1fV, %.0f%%', voltage, percentage * 100)

    while not rospy.is_shutdown():
        msg = BatteryState()
        msg.header.stamp = rospy.Time.now()
        msg.voltage = voltage
        msg.percentage = percentage
        msg.power_supply_status = BatteryState.POWER_SUPPLY_STATUS_DISCHARGING
        pub.publish(msg)
        rate.sleep()

if __name__ == '__main__':
    try:
        main()
    except rospy.ROSInterruptException:
        pass
