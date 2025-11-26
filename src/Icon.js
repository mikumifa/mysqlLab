import React from 'react';

const AppLogo = ({ size = 24, className = "" }) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {/* 数据库主体 (南大紫) */}
            <path
                d="M16 21C9.373 21 4 18.761 4 16V10C4 7.239 9.373 5 16 5C22.627 5 28 7.239 28 10V14.5"
                stroke="#62007E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <ellipse
                cx="16"
                cy="10"
                rx="12"
                ry="5"
                stroke="#62007E"
                strokeWidth="2.5"
                fill="#62007E"
                fillOpacity="0.1"
            />
            <path
                d="M4 16C4 18.761 9.373 21 16 21"
                stroke="#62007E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeOpacity="0.3"
            />

            {/* 锁元素 (琥珀金 - 代表锁机制) */}
            <g transform="translate(16, 14)">
                {/* 锁梁 */}
                <path
                    d="M3.5 6V3.5C3.5 2.12 4.62 1 6 1C7.38 1 8.5 2.12 8.5 3.5V6"
                    stroke="#D97706"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                {/* 锁体 */}
                <rect
                    x="1"
                    y="6"
                    width="10"
                    height="8"
                    rx="2"
                    fill="#F59E0B"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                />
                {/* 锁孔 */}
                <circle cx="6" cy="10" r="1.5" fill="#FFFFFF" />
            </g>
        </svg>
    );
};

export default AppLogo;
